# Aria iOS · SwiftUI 本地交互演示

原生 iOS 前端，以提供的 HTML 原型最终浅色样式为参考。品牌为 **A / Aria / 让复杂工作有清晰的下一步。** 使用 SwiftUI、系统字体和 SF Symbols，不嵌入 WebView，不依赖第三方库。

## 当前状态

- 已提供完整 Xcode 工程、8 个 Swift 应用源文件、应用图标和 XCTest 测试目标。
- 已通过 **107 项可移植结构与安全检查**，并经过独立源码复核。
- **未执行 Swift 编译、XCTest、iOS 模拟器、真机或 VoiceOver 测试**：交付环境没有 macOS、Xcode 或 Swift 工具链。源码检查不能替代编译或界面验收。
- 这是 mock-only 前端，不是可发布的生产 App，也未接入 AriaAI 后端。

## 在 Xcode 中运行

1. 使用安装 Xcode 16 或更新版本的 Mac，并安装一个 iOS 17 或更新版本的模拟器运行时。
2. 打开 `Aria.xcodeproj`。在 AriaAI 仓库中，该文件位于 `ios/Aria.xcodeproj`。
3. 选择 **Aria** scheme 和一个 iPhone 模拟器，点击 Run（⌘R）。没有外部包需要下载。
4. 首次启动会显示启动页和三页引导。登录可使用 `demo@example.com` 与 `demo123` 等模拟内容；请勿输入真实密码。
5. 真机运行需在 Signing & Capabilities 中选择自己的开发团队，并按需修改 bundle identifier。工程不包含签名证书或开发团队资料。

最低系统版本：iOS 17.0。iPhone 为竖屏；iPad 支持横竖屏并限制部分内容宽度。iPad 和极端文字尺寸布局仍需在 Xcode 中检查。

### 命令行检查

在本目录执行：

```bash
python3 Scripts/validate_project.py
```

在 Mac 上完成真实构建：

```bash
xcodebuild -project Aria.xcodeproj -scheme Aria   -configuration Debug -sdk iphonesimulator   -destination 'generic/platform=iOS Simulator'   CODE_SIGNING_ALLOWED=NO build

xcrun simctl list devices available
# 将 SIMULATOR_UDID 换成上一步列出的可用设备 ID。
xcodebuild -project Aria.xcodeproj -scheme Aria   -destination 'platform=iOS Simulator,id=SIMULATOR_UDID' test
```

工程已直接提交，不需要 XcodeGen。只有增删源文件或修改构建配置时，才需要重新生成：

```bash
python3 Scripts/generate_project.py
python3 Scripts/validate_project.py
```

生成器输出固定的对象 ID，可以复现已提交的工程和共享 scheme。

## 已实现的路径

| 区域 | 本地交互 |
| --- | --- |
| 首次进入 | 启动页 → 三页可滑动/跳过引导 → 邮箱与密码模拟登录 |
| 聊天 | 五个示例会话、新建会话、输入/发送、按会话隔离的延迟回复、全文搜索、复制、长按菜单、左滑引用回复、取消引用 |
| 编辑器 | 引用示例资料、麦克风进入模拟语音、发送按钮随输入状态更新 |
| 审批 | 聊天卡片、详情、状态页共用同一决定；允许/拒绝幂等，动态筛选同步变化 |
| 状态 | 动态 / 待审批 / 日程 / 身份四个分段与设置入口 |
| 语音 | 白色全屏、彩色呼吸光球、听/想/说三个可切换状态、模拟字幕、静音、字幕开关、打断、深色结束按钮 |
| 电话 | 资费说明确认 → 约 1.7 秒模拟呼叫 → 计时/静音/免提/拨号键盘 → 红色挂断 → 聊天摘要；取消会撤销待连接任务 |
| 动态 | 全部/待处理/已完成筛选、下拉/按钮刷新、更新时间、真实空状态、详情 |
| 灵感 | 原型主题建议卡片、换一批、反馈状态、详情、带回聊天 |
| 目标 | 原型中的产品/英语目标、进度、可勾选清单、详情与时间线 |
| 资料库 | 文档/原型/图片/音频筛选、搜索、无结果/空类型状态、收藏、详情与示例预览 |
| 设置 | 连接与设备、安全与权限、沟通、体验与数据分组；Gmail 模拟连接切换；通知演示；退出登录与重看引导 |

从详情页“带回聊天”只预填输入框，不会自动发送。动态、资料库和设置中的数据均有示例/模拟说明。

## 原型对齐与原生调整

- 采用 HTML **最后生效**的浅色覆盖，而非较早的深色规则：背景 `#F7F7F8`、白色卡片、正文 `#29292D`、次要文字 `#68686E`、强调色 `#0F8F72`。
- 保留最终的三页引导文案、五个导航入口、项目主题示例内容、审批层级、设置分组、白色语音/电话页与三种光球配色。
- 语音控件为静音/字幕/结束三个深色按钮。点击正在说话的光球可打断并回到听的状态；电话挂断为红色。
- 使用原生 TabView、NavigationStack、sheet、菜单与键盘行为；会话列表采用原生弹层。未声称 CSS 像素级复刻。
- 修复原型展示脚本中的状态局限：新建和切换会话有独立消息；搜索包含新消息；所有消息共用复制/回复交互；审批决定跨页面一致；重复进入通话会重置控件。
- 登录增加邮箱格式和六位模拟密码校验；不会制造真实账号、条款接受或密码找回流程。未接入真实条款页面。
- 电话保留运营商计费的设计说明，但明确为无费用的模拟体验，不展示未经证实的实际价格。
- 为本地演示添加说明、无障碍标签、减弱动态效果支持与大字控件布局。系统深色模式不会改变浅色主题。
- 原始 HTML、上传文件、参考截图和个人账号资料不包含在代码包或公共提交中。

## Mock 与隐私边界

无 HTTP 请求、WebSocket、后台服务、账号服务、遥测或分析 SDK。无 AVAudioSession、录音、STT、TTS、CallKit、真实拨号、付款、OAuth 或 Google API。

登录密码只存在于登录视图的临时状态，成功后立即清空，不进入 AppStore，不写入 UserDefaults、Keychain 或日志。邮箱只保留于当前进程，退出即清空。唯一的持久化数据是“已完成引导”标记。

聊天、审批、收藏、目标清单、设置开关均为内存/页面状态；应用重启或退出后回到演示初始状态。通知开关不会触发系统权限，示例资料按钮不读取本机文件。电话键盘只显示数字，不发送拨号音。

后续若连接真实 AriaAI 服务，项目、客户、资料、审批、权限与审计仍应由 AriaAI 原生服务管理。此版本不引入 Codex SDK、App Server 或运行时子进程依赖。

## 文件结构

```text
Aria.xcodeproj/             可直接打开的工程与共享 scheme
Aria/
  AriaApp.swift             应用入口、首次进入路由、五个 Tab
  Models.swift              内存状态、会话、审批、模拟回复
  DesignSystem.swift        颜色、品牌和共享组件
  WelcomeViews.swift        启动、引导、登录
  ChatViews.swift           聊天、搜索、会话列表和审批详情
  VoiceViews.swift          语音光球与电话演示
  ContentViews.swift        动态、灵感、目标、资料库、状态页
  SettingsViews.swift       分组设置与模拟连接器
  Assets.xcassets/          图标和强调色
AriaTests/AriaTests.swift   12 个 focused XCTest 测试
Scripts/                   工程生成与可移植检查
QA.md                      待在 Mac 上执行的验收清单
```

## 验证范围

已执行：工程 OpenStep 完整解析、全部对象引用与源文件解析、共享 scheme XML、目标/编译阶段关联、JSON 资源、1024×1024 不透明图标、mock 边界静态检查、浅色配置和关键交互代码检查、生成器可复现性检查。

已编写但未运行的 XCTest 覆盖首次进入、引导持久标记、登录/退出重置、审批幂等/拒绝、新会话/上下文预填、并发会话回复隔离、防重复发送、退出取消延迟回复、邮箱校验与固定模拟回复。

尚未验证：SwiftUI 类型检查、真实链接、模拟器启动、实际手势/键盘、安全区、尺寸适配和 VoiceOver。请以 `QA.md` 和 Xcode 构建结果为下一阶段验收依据。
