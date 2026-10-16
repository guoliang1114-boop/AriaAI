# Aria 原生云端语音 v1

## 交付与启用边界

这是可审阅、默认关闭的真实语音接入代码，不是已完成真机/供应商验收的生产功能。iOS 已增加独立的真实账号入口、WebSocket 控制器和 AVAudioEngine 录放音；后端转发火山引擎流式 ASR/TTS，并调用 Aria 原生 Agent。

本轮没有开通服务、创建/配置密钥、调用计费供应商、部署服务或运行 iOS 构建。必须先完成以下事项才能启用：

1. 所有者确认实际 ASR/TTS 产品、资源 ID、音色、费用与预算，并授权启用；注册账号本身不等于服务开通。
2. 在服务器安全配置供应商密钥。密钥不进入 iOS、仓库、日志、远程配置或聊天。
3. 验证专用双向 TTS 的 PCM 实际位深、声道和字节序。官方资料明确支持 `pcm` / 24kHz，但本次能核实的资料没有明确位深/声道。不能借用另一个实时对话接口的 PCM 语义。`VOICE_TTS_PCM_LAYOUT_CONFIRMED=false` 是强制阻断项，只有授权样本证明为 PCM16LE 单声道 24kHz 才可改为 true；否则先实现并测试正确的转换，不得硬开开关。
4. Mac 上编译并执行 XCTest；真机验证麦克风、重采样、回声抑制、打断、耳机/蓝牙路由、锁屏和网络中断。
5. 验证自己服务器的 HTTPS/WSS、反向代理前缀及访问控制。默认旧部署模板不能被当作已部署可用的证据。

## 入口与身份隔离

聊天麦克风提供“本地语音演示”与“连接自己的 Aria 服务器”。后者要求输入自己的 HTTPS API 地址，使用现有 `POST /auth/login`、`X-Auth-Token` 和整数 conversation ID。URL 不允许用户名/密码、查询参数、片段或 HTTP。拒绝 HTTP 重定向，避免登录正文/令牌被转发。登录和令牌仅在当前进程的独立 API 实例中存在，不进入 AppStore、本地演示快照、UserDefaults、Keychain 或 URL。

真实列表使用 `/chat/conversations` 和 `/chat/conversations/{id}/messages`，允许显式新建独立会话。原五页和本地演示的数据继续独立；mock 登录绝不用于请求付费语音。电话入口仍是原来的演示，不包含真实电话、CallKit、RTC 或后台持续通话。

## 后端调用链

`/voice/session` 是显式授权的 WebSocket 路由。HTTP 中间件不覆盖 WebSocket，因此握手前直接调用原生 `get_current_user`；收到 session.start 后用 `require_chat_request_access(... require_write=True)` 验证会话权限。每个新识别段、final 和定时检查均重新校验真实账号/权限。UserToken 使用其创建时间加 voice token TTL；无创建时间的历史 token 重新验证原生映射，并受短连接时限约束。

final 只进入一次 `prepare_chat_runtime_async` → `stream_chat_events`。每个回答在独立 task 中消费原生 SSE，避免原生运行注册/取消误伤 WebSocket 接收任务。原生工具、HITAS、权限、记忆、持久化及审批逻辑没有被替换。

原生同时发出 legacy `text` 与 product `text_delta`，这里只消费一份 legacy text 送给 TTS，防止双读。产品事件以 `agent.event` 保留原始结构，且仅转发当前账号已有权查看的会话事件。语音 final 不接受 recovery、工具名、owner ID 或审批参数。

审批需要在真实 Aria 网页会话中审阅，iOS 提供同源网页入口；语音中说“同意”不会确认工具调用，也不会绕过原生审批端点。原生 pending action 仍是唯一审批记录。

## 应用 WebSocket 协议 v1

连接：自己的 `wss://<origin>/<api-prefix>/voice/session`，认证头 `X-Auth-Token`。禁止查询串 token。

首条 JSON 必须且仅包含：

```json
{"type":"session.start","version":1,"conversation_id":42,"locale":"zh-CN","input_audio":{"encoding":"pcm_s16le","sample_rate":16000,"channels":1,"frame_ms":20},"output_audio":{"encoding":"pcm_s16le","sample_rate":24000,"channels":1}}
```

服务器 `session.ready` 返回 version、服务端 session_id、相同音频格式及 limits。客户端校验后才启动引擎。双方不猜测格式，也不自动回退到另一供应商。

音频为 WebSocket binary，一条消息一帧，28 字节头：

| 偏移 | 字段 |
|---|---|
| 0..3 | ASCII `ARV1` |
| 4 | kind：1 输入 / 2 TTS |
| 5 | flags：必须为 0 |
| 6..7 | reserved UInt16 BE：必须为 0 |
| 8..23 | UUID 原始 16 字节 |
| 24..27 | UInt32 BE sequence，从 0 严格递增 |
| 28.. | PCM payload，非空、偶数字节，最多 65,536 字节 |

输入 UUID 是 utterance_id，每帧固定 640 字节（20ms）；输出 UUID 是 response_id。输出帧与 text/tts.done 的 response_id 一致；重复、缺口或旧代数据不能进入新回答的播放器。

客户端控制：
- `audio.commit`：utterance_id、last_sequence。只提交当前完整段一次。
- `response.interrupt`：response_id。立即停本机播放，发送取消，再开始新段。
- `session.end`：无附加字段。结束当前连接和资源。

服务器事件：
- `session.ready` / `session.ended`
- `asr.partial`：utterance_id、text（累计可修订文本，不是追加 token）
- `asr.final`：utterance_id、response_id、text（一次进入 Agent）
- `text.delta`：response_id、text
- binary TTS 帧；`tts.done`：response_id、last_sequence（无音频为 -1）
- `agent.event`：response_id、原生 event
- `response.done`：response_id、run_id、status；`response.interrupted`：response_id
- `error`：code、固定安全 message、retryable、fatal，可选 response_id
- `latency`：response_id 与可用的 asr_first_ms / asr_final_ms / agent_first_ms / tts_first_ms

错误码统一为 permission_denied、network_unavailable、asr_unavailable、agent_unavailable、tts_unavailable、rate_limited、session_expired。格式错误关闭连接且不回传攻击输入。客户端额外的协议/设备异常只用于本地 UI，不是供应商错误透传。

## 流式与取消

ASR：iOS 单次发言按保守上限 20s 自动提交（同时服从服务端更低上限）；后端将 20ms 帧积累为官方建议的 200ms/6400 字节包。commit 发负 sequence 最后一包，等待最终结果。累计 partial 只更新字幕；client utterance UUID 和 final_seen 在 await 前去重。上游断开/超时不能变成一次虚构的成功 final。

Agent：收到文字增量即更新字幕。首块最多等待约 40 字符或句末，后续约 120 字符或句末；不足一块的尾文在原生流结束时提交。TTS 使用官方 bidirectional 的多个 TaskRequest，未等待整篇答案后才合成。

TTS：每个 response 使用独立供应商 WS/session；正确等待 StartConnection/StartSession，逐块发文本，FinishSession，接收对应 session 的音频/完成事件。供应商二进制元数据在后端剥离。PCM 分片可跨奇数字节边界，后端重组；最终残留半个 sample 视为错误。输出按 24kHz 播放速度限速，最多约 200ms 预送，避免客户端排队无界。

打断：本机立即失效播放代次并 stop/flush player；后端先标记当前 response 为 interrupted，禁止迟到音频，再取消 TTS。已有 run_id 走原生 `cancel_chat_run` 的持久取消路径；准备阶段没有 run_id 时取消准备任务。等待原生清理后才能接收下一段。真实工具如果已经完成或进入审批，不伪造“撤回成功”。断网/撤权同样结束本地执行与供应商连接；不能保证撤销已经在第三方完成的业务动作。

TTS 非致命失败保留原生文字流与历史，允许查看文字；ASR、认证和不安全的协议失败结束连接。原始录音、PCM、供应商 payload 不保存，不添加内容或凭据日志。

## iOS 音频与生命周期

- `VoiceSessionController` 是 MainActor 状态所有者：idle / connecting / listening(partial) / thinking(final) / speaking(subtitle) / interrupted / failed。
- AVAudioSession `.playAndRecord` + `.voiceChat`，AVAudioEngine 硬件 voice processing 必须成功，没有原始麦克风回退。录音转换、PCM 分帧、播放调度在专用串行队列；tap 与 MainActor mailbox 都有容量限制。
- 捕获经 AVAudioConverter 重采样为 mono16k PCM16LE。AVAudioPlayerNode 连续播放 mono24k PCM；不会把每个供应商分片当作独立 MP3 文件。
- 本地 VAD 使用经回声处理后的 RMS、噪声底、连续语音帧和播放初期保护窗。播放中检测到新的用户语音会先打断再提交新段。此启发式必须在真机验证，不能声称已经解决所有扬声器回声/蓝牙场景。
- 静音、免提、手动打断、结束、可重试错误均由控制器协调。进入后台/音频中断/物理路由改变会停止并清理；回前台不自动开麦或重连。
- 首次播放指标是“提交→首次 player 调度”的单机单调时钟估计，不是声学输出延迟。ASR first 是识别开始→首字幕；ASR final 是 commit→final；Agent/TTS first 是 final/response 开始→首文字/首发送音频。不同阶段不可盲目相加，也不跨服务器/手机绝对时钟相减。

## 配置、费用控制与恢复

配置只由 `backend/app/config.py` 从服务端环境读取。`backend/voice.env.example` 仅有空值和关闭默认值；不把它当作已开通配置。账号密钥由所有者安全填写，resource/speaker 必须来自真实控制台。

应用默认上限（不是供应商商业配额）：会话 300s、空闲 30s、回答 120s、单段 60s、输入 9,600,000 字节、会话输出文本 12,000 字符、每用户并发 1、每会话最多 60 个识别段、每日输入 1800s、每日 TTS 60,000 字符。按输入音频和送往 TTS 的字符结算；实际账单仍以供应商规则为准。服务端硬上限避免环境变量误填导致无限使用。

在任何上游连接前，使用原生 Setting 表中的 `voice.usage.v1:` 内部记录预留最坏用量。PostgreSQL 行锁跨进程序列化用户并发/日计数；SQLite 使用事务写锁。正常结束按实际用量结算；进程崩溃或清理未完成保留预留，不错误退款。即使供应商握手失败、没有返回 stream，也用 sticky/pending 清理状态阻止结算；关闭超时或重复取消不能悄悄抹去不确定性。取消连接而尚未取得 socket 所有权也保守保留额度，这只是应用额度预留，不表示供应商实际收费。账本不可通过通用 settings API 读取、创建或修改（管理员也不例外）。无新数据模型和迁移。

并发 lease 到期才释放，保留安全清理余量。每日计数和 session 幂等记录没有自动删除，需未来在审计/保留策略下维护；本轮没有删除既有数据。日历按 UTC。达到限额发 rate_limited，不自动加购/换账号/换供应商。

## 验证方式

只在独立测试数据库、假的 Agent/供应商/socket 上运行后端测试：

```bash
cd backend
.venv/bin/python -m pytest -q tests/test_voice_protocol.py tests/test_voice_session.py tests/test_voice_limits.py tests/test_voice_native.py tests/test_voice_settings.py
```

不要为了离线测试启动 `main.py` 的 lifespan：既有应用启动包含迁移和模型 warmup，可能触达真实服务。iOS 可移植检查仅解析工程/源码契约，不执行 Swift：

```bash
python3 ios/Scripts/generate_project.py
python3 ios/Scripts/validate_project.py
```

授权后的逐步验收：真实单轮 ASR→原生 Agent→TTS；增量首包与取消/旧包隔离；连续多轮；拒绝无令牌/外部会话；撤权/过期；各限额；断网/超时/429；批准仍由原生审批页完成；最后测扬声器回声/耳机/蓝牙/后台/锁屏和端到端延迟。没有测试通过前，不应标记为生产就绪。

## 协议依据

- [官方双向流式 ASR](https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)
- [官方双向 TTS 指南](https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-text-to-speech-websocket?lang=zh)
- [官方 TTS v3 二进制事件协议](https://docs.volcengine.com/docs/DoubaoVoice/WebSocketBidirectionalStreaming-V3?lang=zh)

实现按公开协议自行编写，未嵌入第三方示例程序或运行供应商下载脚本。专用 TTS PCM 布局的未验证点如上，不能由离线模拟帧测试消除。
