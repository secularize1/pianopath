# 发布到 GitHub

当前环境没有 GitHub 登录凭据，所以无法在不持有你账户权限的情况下替你创建公开仓库。这个目录已经是完整的 Git 仓库，首个提交已完成。

## 方式 A：网页上传

1. 在 GitHub 新建空仓库，名称建议 `pianopath`，**不要**勾选 README、.gitignore 或 License。
2. 解压 `PianoPath-repo.zip`。
3. 在 GitHub 仓库页面选择 **Add file → Upload files**，上传解压后的全部内容。
4. 提交后进入 **Settings → Pages**，Source 选 **GitHub Actions**。
5. 已包含 `.github/workflows/pages.yml`，下次推送到 `main` 会自动部署。

## 方式 B：命令行推送

在 GitHub 新建空仓库后，在本目录打开终端：

```bash
git remote add origin https://github.com/你的用户名/pianopath.git
git branch -M main
git push -u origin main
```

如果账户已配置 SSH：

```bash
git remote add origin git@github.com:你的用户名/pianopath.git
git branch -M main
git push -u origin main
```

## GitHub Pages

推送完成后：

1. 打开仓库 **Settings → Pages**。
2. Source 选择 **GitHub Actions**。
3. 打开 **Actions**，确认 `Deploy PianoPath to GitHub Pages` 成功。
4. 站点地址为 `https://你的用户名.github.io/pianopath/`。

## 注意

- GitHub Pages 是纯静态托管，打卡和个性化数据会保存在访问者自己的浏览器。
- 需要服务端 JSON 持久化时，运行 `python server.py` 或部署到支持 Python 的环境。
- 国内网络下 B 站内嵌播放器可用；YouTube 仅出现在“全部来源”里，不参与默认学习路径。
- 发布前请阅读 `资源核验.md`，平台粉丝数会随时间变化。
