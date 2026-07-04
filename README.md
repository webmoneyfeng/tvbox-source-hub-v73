# TVBox Source Hub v7.3

国内稳定免费版 TVBox/FongMi/影视仓聚合入口。

- 主入口：`https://tv.webhome.eu.org/config.json`
- 同构入口：`https://tv.webclound.eu.org/config.json`
- 回滚入口：`https://tvbox-source-hub.feng-yang.workers.dev/config.json`

## 设计

- 电视端只显示一个点播站点：`影视点播`。
- Worker 优先读取静态快照，失败后动态聚合 CMS。
- GitHub Actions 生成 `dist/snapshot/latest` 快照，避免每个节目一个文件。
- 不托管视频文件，不代理视频流，只维护配置、索引、分类、筛选和验证逻辑。

## 常用命令

```powershell
npm run check
npm run generate:snapshot
$env:TVBOX_BASE='https://tv.webhome.eu.org'; npm run validate:online
```

## Cloudflare

Worker：`tvbox-source-hub-v73`

Custom Domains：

- `tv.webhome.eu.org`
- `tv.webclound.eu.org`

KV：复用 `TVBOX_KV` 只读绑定，用于直播/旧静态目录兜底。
