# 辉夜姬Invanta 美食图鉴

一个只读展示金山文档《辉夜姬Invanta美食图鉴》的筛选网站。

## 结构

- `docs/`：网站静态文件，GitHub Pages 直接发布此目录。
- `sync/sync.py`：从金山文档下载并解析数据，生成 `docs/data.json`、`docs/meta.json`、`docs/updates.json`。
- `sync/state/prev.json`：用于计算“最近更新”的上一次数据快照。
- `.github/workflows/sync.yml`：每 15 分钟自动同步一次。

## 本地预览

```bash
python sync/sync.py
python -m http.server 4173 --directory docs
```

然后打开 http://127.0.0.1:4173/

## 发布到 GitHub Pages

1. 在 GitHub 新建一个空仓库。
2. 推送本目录到该仓库。
3. 仓库 `Settings → Pages` 选择 `Deploy from a branch`，分支 `main`，目录 `/docs`。
4. 等待 Pages 构建完成，使用 `https://<用户名>.github.io/<仓库名>/` 分享给群友。

之后无需维护：金山文档有改动时，GitHub Actions 会自动同步并刷新网页。
