# Aria CLI 使用说明

脚本位置：

```bash
AriaAI/backend/scripts/aria_cli.py
```

建议在后端目录执行：

```bash
cd AriaAI/backend
scripts/aria_cli.py --help
```

## 登录与配置

```bash
scripts/aria_cli.py auth login --email you@example.com
scripts/aria_cli.py auth me
scripts/aria_cli.py config show
```

默认 API 地址是 `http://localhost:8000`。也可以指定：

```bash
scripts/aria_cli.py --base-url https://aria.d2cgo.co/api auth login --email you@example.com
```

CLI 会把 `base_url` 和 token 保存到 `~/.aria-cli.json`。

> 线上站点的后端接口挂在 `/api` 下。新版 CLI 如果误填根域名 `https://aria.d2cgo.co`，登录时会在遇到 nginx 405 后自动重试 `https://aria.d2cgo.co/api` 并保存正确地址。

## 项目

```bash
scripts/aria_cli.py projects list
scripts/aria_cli.py projects show 27
scripts/aria_cli.py projects detail 27
scripts/aria_cli.py projects create --client "东阿阿胶" --name "新业务进入策略"
```

## 项目空间

```bash
scripts/aria_cli.py folders list --project-id 27
scripts/aria_cli.py folders create --project-id 27 --name "客户确认材料"

scripts/aria_cli.py files list --project-id 27
scripts/aria_cli.py files upload --project-id 27 --path ./brief.docx --folder-id 1
scripts/aria_cli.py files delete --project-id 27 --file-id 123
```

## Chat 与 Skill

```bash
scripts/aria_cli.py chat send --project-id 27 --message "总结当前项目"
scripts/aria_cli.py chat conversations --project-id 27
scripts/aria_cli.py chat messages 88

scripts/aria_cli.py skills list
scripts/aria_cli.py skills run "Office 文档读写助手" --project-id 27 --message "读取项目文件并生成一份总结 DOCX"
```

`--message -` 支持从 stdin 读取：

```bash
cat prompt.txt | scripts/aria_cli.py chat send --project-id 27 --message -
```

## 项目管理

```bash
scripts/aria_cli.py todos list --project-id 27
scripts/aria_cli.py todos create --project-id 27 --content "确认客户会议时间"
scripts/aria_cli.py todos done --project-id 27 --todo-id 5

scripts/aria_cli.py milestones list --project-id 27
scripts/aria_cli.py milestones create --project-id 27 --title "完成初版方案"

scripts/aria_cli.py financials list --project-id 27
scripts/aria_cli.py financials add --project-id 27 --amount 50000 --date 2026-05-17 --note "首付款"
```

## 记忆与简报

```bash
scripts/aria_cli.py memory get --project-id 27
scripts/aria_cli.py memory rebuild --project-id 27
scripts/aria_cli.py memory generate-summaries --project-id 27 --force

scripts/aria_cli.py briefing get --project-id 27
scripts/aria_cli.py briefing refine --project-id 27 --meeting-type status --language zh
```

## 客户与设置

```bash
scripts/aria_cli.py clients list
scripts/aria_cli.py clients show 3
scripts/aria_cli.py clients projects 3

scripts/aria_cli.py settings list
scripts/aria_cli.py settings get selected_model
scripts/aria_cli.py settings set selected_model gpt-4o
```

## 任意 API 兜底

所有网站接口都可以通过 `api` 命令直接调用：

```bash
scripts/aria_cli.py api GET /projects/27/detail
scripts/aria_cli.py api POST /skills/seed-pro
scripts/aria_cli.py api PUT /settings/selected_model --body '{"value":"gpt-4o"}'
scripts/aria_cli.py api POST /projects/27/todos --body '{"content":"准备会议纪要"}'
```
