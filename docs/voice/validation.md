# 云端语音验证记录

日期：2026-10-16（UTC）。结果只对应本次源码；不是生产/供应商验收证明。

## 实际运行

- Python 3.12；隔离 venv 中使用仓库指定 FastAPI 0.115.6、Starlette 0.41.3、uvicorn 0.32.1、SQLModel 0.0.22、websockets 14.2。未修改系统安装。
- 201 项后端离线测试通过：`test_voice_protocol.py`、`test_voice_session.py`、`test_voice_limits.py`、`test_voice_native.py`、`test_voice_settings.py`、现有 `test_turn_interrupt.py` 与 `test_product_run_events.py`。
- 另 37 项现有 `test_settings.py` 与 `test_chat_security.py` 回归通过；设置测试显式使用本次创建的临时 SQLite 文件，不访问部署数据库。合计 238 项通过。
- Mini FastAPI WebSocket 集成测试只注册 voice router；真实原生 token/ACL 与独立 SQLite，ASR/TTS/Agent 执行替身。未启动 main lifespan，未触发 warmup、迁移或服务调用。最终把上述两组测试合并运行，238 项在同一次运行中全部通过。
- 181 项 iOS 可移植工程/源码检查通过。完整 OpenStep 解析、重复键拒绝、对象/源文件引用、共享 scheme XML、两测试文件编译阶段、图标、权限说明、mock/真实模式隔离与静态安全契约。
- 生成器在临时副本运行后，project.pbxproj 与共享 scheme 字节相同。13 个应用 Swift 文件、2 个测试文件。
- Python 语法检查与 `git diff --check` 通过；新增供应商/客户端代码没有内容或凭据日志，供应商 config repr 隐藏密钥。失败/取消的供应商握手清理也有独立回归：close 失败、close 超时、cleanup 再次取消、未返回 socket 的 connect 取消均保留最坏额度预留，原始 CancelledError 仍传播。
- 独立源码审查覆盖原生音频与控制器、后端执行取消/清理、官方供应商协议。发现的 token 撤销、半开连接、响应缓冲、取消竞态与账本设置接口绕过均已修正并补充测试。

## 已编写但没有执行

80 个 XCTest 方法：原本 51 个本地演示/持久化测试，7 个 endpoint/二进制帧测试，22 个使用 fake 权限、audio 和 socket 的控制器测试。测试实例使用无效测试域名且不会调用真实网络或麦克风。

## 尚未验证 / 阻断启用

- 无 macOS、Swift 或 Xcode：Swift 类型检查、链接、XCTest 执行、模拟器与真机 UI/VoiceOver 均未运行。
- 无火山引擎激活/费用/调用授权：未发送任何真实语音、文字或计费请求。资源 ID、音色、额度、真实响应及供应商计费行为未验证。
- 专用双向 TTS PCM 位深/声道/字节序必须确认。当前固定客户端契约 PCM16LE mono24k；配置门槛保持 false。官方资料无法证明此布局时，不能宣称集成已经可用。
- 硬件 voice processing、AEC 效果、用户抢话与回声误判、AVAudioConverter 行为、首次可听延迟、耳机/蓝牙/系统中断须在物理设备测量。
- PostgreSQL 跨进程行锁和真实部署下负载尚未运行；本次可执行账本测试使用隔离 SQLite。
- Nginx 文件只是未应用的示例，没有 reload、部署或 `nginx -t` 验证。需核对现有 `/api` 前缀映射及 HTTPS/WSS。

验收步骤与安全配置见 [协议和启用说明](cloud-voice-v1.md)，iOS 场景清单见 [QA](../../ios/QA.md)。
