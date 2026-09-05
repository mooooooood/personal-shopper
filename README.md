# PERSONAL SHOPPER · 轻量代购展示站

基于 FastAPI 的品牌、产品与联系方式展示网站，面向 1 核 CPU / 1GB RAM / 20GB 磁盘的 Linux 服务器。包括首页、健身器械/钓鱼竿/电吉他三个详情页、响应式布局、404 页面、健康检查与站点地图。

## 要安装的框架与软件

| 软件 | 用途 |
| --- | --- |
| Python 3.12（推荐） | 运行环境 |
| FastAPI | 网站框架 |
| Uvicorn | ASGI 服务，生产只开 1 个 worker |
| Jinja2 | HTML 模板，自动转义内容 |
| Nginx | 域名入口、HTTPS、静态资源服务 |
| systemd | 后台运行、开机启动、故障重启 |

前端是原生 HTML + CSS；无 Node.js 构建、数据库、Redis、后台上传服务或 Docker 依赖。生产依赖精确版本见 requirements.txt。页面在进程启动时渲染并缓存，访问时不重复读配置或渲染模板。图片由浏览器按需加载。

## 本地启动

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

访问 http://127.0.0.1:8000 。`--reload` 仅用于开发。

## 修改品牌、产品与联系方式

编辑 `data/site.json`：

- `brand`：品牌英文名，当前为 PERSONAL SHOPPER。
- `hero_title`、`hero_note`、`about`：首页介绍。
- `contact.email` / `phone` / `wechat` / `address`：填写实际联系方式，空值不展示。邮箱和电话填写后自动生成可点击链接。
- `products`：产品列表；每个产品需要唯一的英文 `slug`（小写字母、数字、短横线）、名称、分类、简介、介绍、图片及规格。
- `image`：图片放到 `app/static/images/`，填 `/static/images/fitness.webp` 这样的本站路径。当前使用明确标注的图片待添加区域，未编造商品照片、价格和库存。
- `demo`：当前 `true` 会显示“具体型号、报价和货期请咨询”的提示。确认信息后可设为 `false`。

推荐 WebP 图片，宽度约 1000px，尽量每张 100–250KB。不要把原始大图和视频堆进服务器。修改配置或模板后需重启服务，开发 reload 不会监控 JSON：手动重启开发进程即可。

## Ubuntu 24.04 部署

以下假设站点安装到 `/opt/personal-shopper`，使用系统的 `www-data` 低权限账号运行。Nginx 配置按单域名独立站编写，已有站点的机器应保留原配置。

1. 安装环境：

```sh
sudo apt update
sudo apt install -y python3 python3-venv nginx git
```

2. 从私有仓库克隆（使用自己的 GitHub SSH 登录配置，或将项目上传到该目录；不要把令牌写入仓库 URL）：

```sh
sudo mkdir -p /opt/personal-shopper
sudo chown "$(id -un):$(id -gn)" /opt/personal-shopper
git clone git@github.com:mooooooood/personal-shopper.git /opt/personal-shopper
cd /opt/personal-shopper
python3 -m venv .venv
.venv/bin/pip install --no-cache-dir -r requirements.txt
cp .env.example .env
nano .env
```

将 `.env` 的 `SITE_URL` 改为正式网址，例如 `https://shop.your-domain.com`。systemd 会加载此文件，本地直接运行 Uvicorn 不会自动加载它。若不配置域名，首页仍可运行，但不会输出 canonical / sitemap。

3. 修改 `data/site.json`，填写联系方式及真实产品资料，加入图片。确保 `/opt/personal-shopper` 及内部文件对 `www-data` 可读，目录可遍历（常规目录 755、公开站点文件 644）；不需要把源码写权限给 Web 服务。

4. 安装后台服务：

```sh
sudo cp deploy/personal-shopper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now personal-shopper
curl -f http://127.0.0.1:8000/healthz
```

返回 `{"status":"ok"}` 即启动成功。

5. 设置域名解析到服务器 IP；编辑 `deploy/nginx.conf`，将 `example.com` 换成实际域名，然后启用：

```sh
sudo cp deploy/nginx.conf /etc/nginx/sites-available/personal-shopper
sudo ln -s /etc/nginx/sites-available/personal-shopper /etc/nginx/sites-enabled/personal-shopper
sudo nginx -t
sudo systemctl reload nginx
```

在云服务器安全组放行 80 和 443；保留已有 SSH 管理端口。8000 只监听本机，无需向公网开放。网站只有只读页面，没有留言表单或付款功能。

6. 为已经解析到本机的域名启用 HTTPS：

```sh
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的真实域名
sudo certbot renew --dry-run
```

按提示填写证书联系邮箱并完成 HTTPS 配置；证书命令需要联网、域名正确解析且 80 端口可达。

## 1GB 服务器运行设置

- Uvicorn 固定 1 worker；多个进程会增加内存。并发上限 40，超出可能返回 503，可根据实际流量调整。
- systemd `MemoryMax=256M` 是应用进程的限制，不是已测得的内存占用或整机限制；触顶可能导致进程被终止并重启。需部署后观察使用量。
- 不启用开发热重载，不安装开发测试依赖到生产环境。
- Nginx 缓存静态文件 1 小时，开启文本压缩，关闭逐请求访问日志。错误日志仍需保留系统 logrotate 配置，避免填满 20GB 磁盘。
- 内存实际占用因 Python/系统/访问情况变化，不保证固定数值。

```sh
sudo systemctl status personal-shopper
sudo systemctl show personal-shopper -p MemoryCurrent -p MemoryPeak
sudo journalctl -u personal-shopper -n 80 --no-pager
free -h
df -h
```

## 更新与回滚

先备份自己的 `data/site.json` 和图片。切换代码版本前记录 `git rev-parse HEAD`。将运行时配置 `.env` 留在服务器，不提交到 GitHub。

```sh
cd /opt/personal-shopper
git pull --ff-only
.venv/bin/pip install --no-cache-dir -r requirements.txt
sudo systemctl restart personal-shopper
curl -f http://127.0.0.1:8000/healthz
```

如本机修改产品资料导致拉取冲突，先保存/提交这些修改再合并，不要强制覆盖。回滚时切回已记录的提交，重新安装对应依赖并重启。

## 验证

```sh
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -v
```

覆盖：首页、所有详情页、404、私有文件不可访问、样式文件、健康检查、安全响应头、模板转义和自定义域名站点地图。

## 代码托管与网站部署的区别

GitHub 私有仓库保存代码，不运行这个 FastAPI 服务。网站需要按照上面步骤在你的服务器启动。仓库名默认使用 `mooooooood/personal-shopper`；若实际仓库名不同，请替换克隆地址。

## 官方参考

- https://fastapi.tiangolo.com/deployment/concepts/
- https://www.uvicorn.org/settings/
