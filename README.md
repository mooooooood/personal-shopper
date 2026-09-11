# PERSONAL SHOPPER · 中国代购与共享兔子牧场

> Your person in China. For the things you need.

这是一个面向海外买家的英文代购网站。经营者是一位在中国独立工作的一人公司经营者，从中国供应链寻找客户需要的商品，沟通供应商、确认采购细节，并协调国际运输。商品范围以客户需求为起点，家居、服饰、电子、工具、户外和乐器等只是示例方向。

网站坦诚介绍采购与转售的中间商角色，强调直接沟通、跨品类找货和灵活调整。报价会讨论商品价格、利润或约定服务费及运费；具体运输方案按商品与目的地确认。

现在整个首页都是一个所有访客共同游玩的二维兔子牧场。大家看到同一群兔子跳动、结伴、生出不同毛色的宝宝，也可以放胡萝卜、用网抓兔子、把共享篮子里的兔子放回草地。老鹰和灰狼偶尔来访，需要留意预警，把兔子暂时保护在篮子里。一个人的操作会同步给其他访客，刷新或重新进入也会保留牧场进度。画面上只保留悬浮工具与统计；点 **About & contact** 才打开简短的个人介绍和联系方式。希望这片小草地，让初次见面多一点轻松。

## 当前网站内容

- **个人介绍**：第一人称说明一人经营的工作方式，放在随时可以打开或关闭的信件面板里。
- **共享兔子牧场**：Canvas 绘制草地、池塘和不同毛色的兔子；服务器统一管理跳动、结伴和繁殖，所有访客共享兔子、胡萝卜与篮子。支持投喂、捕捉、放回、暂停自己的画面与同步最新状态。
- **随机来访**：老鹰或灰狼偶尔带走一只兔子，先给出短暂预警；篮子里的兔子不会被带走。毛色和事件由服务器决定，所有访客看到同一个结果。
- **采购范围**：八个示例品类与“Something else?”入口，支持按链接、参考图片或描述提出需求。
- **满屏游戏**：去掉原来的网页页头、侧栏和页脚；固定 1000 × 600 的逻辑地图投影到手机或电脑屏幕，同一兔子在所有访客那里使用相同的地图坐标。
- **业务面板**：个人介绍、联系方式、折叠的采购品类与询价工具集中在一个弹窗里，关闭即可回到牧场。
- **询价工具**：在浏览器里生成可编辑、可复制的英文消息；配置邮箱后可打开邮件客户端发送。
- **持久存储**：同一个 SQLite 数据库保存网站资料和共享牧场进度；升级会保留自定义品牌、介绍、联系方式、产品及规格。
- **轻量运行**：FastAPI + Jinja2 + SQLite，适配手机和电脑，面向 1 核 CPU / 1GB RAM / 20GB 磁盘服务器。

[首次部署](#ubuntu-2404-部署) · [已有网站升级](#从旧版升级此次不能只更新模板和-static) · [修改资料](#sqlite-内容管理)

## 要安装的框架与软件

| 软件 | 用途 |
| --- | --- |
| Python 3.12（推荐） | 运行环境 |
| FastAPI | 网站框架 |
| Uvicorn | ASGI 服务，必须只开 1 个 worker，维持唯一共享牧场 |
| Jinja2 | HTML 模板，自动转义内容 |
| SQLite（Python 自带 sqlite3） | 持久化网站资料、共享兔子、篮子、胡萝卜及牧场进度 |
| Nginx | 域名入口、HTTPS、静态资源服务 |
| systemd | 后台运行、开机启动、故障重启 |

前端是原生 HTML + CSS + JavaScript；无 Node.js 构建、独立数据库服务、Redis、后台上传服务或 Docker 依赖。生产依赖精确版本见 requirements.txt。业务页面在进程启动时从 SQLite 读取资料并渲染缓存，访问 HTML 时不重复查询资料或渲染模板。共享牧场由同一个 FastAPI 进程模拟，通过 HTTP 接口同步并按下文规则写入 SQLite；图片由浏览器按需加载。

## 兔子小牧场怎么玩

- **Watch**：看兔子跳动、结伴；点一下兔子会冒出爱心。
- **Carrot**：选择后点草地放胡萝卜，吸引兔子靠近；同时最多 6 根。
- **Catch / Release**：选 Catch 后点兔子收进共享篮子，Release 每次放回一只。来访预警出现时可以先把兔子收进篮子，等老鹰或灰狼离开后再放回。其他访客也能看到并使用这个篮子；抓放操作不会伤害兔子。
- **Pause / Play**：只暂停自己的画面；暂停时禁用投喂、捕捉和放回。Play 重新同步到最新状态，其他访客的游玩不会被你的暂停影响。
- **Sync**：立即获取共享牧场的最新状态，不会清空或重置世界。
- **About & contact / Help**：打开个人介绍和联系卡片，或查看玩法；打开面板时停止连续动画，并降低同步频率，关闭后按原来的播放状态恢复。
- **键盘**：聚焦地图后用方向键移动光圈，Enter 或空格使用工具；W / C / N 切换看兔子、胡萝卜和捕捉。

成年兔子会自动寻找伙伴，以爱心表现配对，随后出现小兔。每只新生兔子的毛色独立随机选择，包含白色、奶油色、焦糖色、巧克力色、银灰色、炭灰色、姜黄色和花斑；毛色在出生时确定，长大、抓放或刷新后不会变化。小兔约 30 秒长大；首次创建共享牧场时有 12 只成年兔子，通常约 12–20 秒能看到第一批出生。之后每位访客进入的都是已经存在的牧场。草地和共享篮子合计最多 60 只，满员后暂停繁殖。

兔子使用更接近真实比例的二维插画：短前腿、饱满后腿、毛发明暗、眼睛高光和胡须。跳跃分成预蹲、后腿蹬地、腾空、前腿落地与缓冲，静止时有轻微呼吸、眨眼和耳鼻动作。每种毛色的身体部件只绘制一次并复用，浏览器再组合姿态，不下载模型或大图，也不增加服务器依赖。显示位置仍由共享快照决定，动画不会自行移动、繁殖或改变兔子。

老鹰或灰狼会在随机时间来访：首次约经过 15–30 秒活跃时间，后续间隔约 35–70 秒，具体以模型计时为准。每次先有约 3 秒预警，随后来访者最多带走草地上的一只兔子，以卡通动画表现，没有血腥画面。篮子里的兔子安全；野生动物不会把草地上的兔子减少到两只以下。抓入篮子可以保护兔子，但这是所有人共用的篮子，其他访客也可以放回兔子。

### 共享状态怎样运行和保存

- **唯一状态**：FastAPI 进程以 10 Hz 更新同一个牧场，负责运动、配对、出生毛色、随机来访和交互结果。浏览器约每 1 秒同步一次，使用平滑绘制显示移动，不自行决定出生、毛色、来访或修改共享数量。所有设备使用同一张固定 1000 × 600 逻辑地图；窗口变化只改变显示投影。
- **及时保存**：在原有 SQLite 数据库内使用 `meadow_state` 表，保存兔子及毛色、共享篮子、胡萝卜、来访事件与相关进度。成功的投喂、捕捉、放回操作立即保存；普通运动状态每 15 秒及服务正常退出时保存。异常掉电或强制终止时，恢复到最近一次成功保存的位置。
- **休息与续接**：没人观看 15 秒后暂停服务器计算，下次有人进入时从已保存或当前内存状态继续，不补算无人观看期间的繁殖或野生动物来访。刷新页面或重新进入不会创建新牧场。
- **浏览器省电**：浏览器以约 30 帧/秒为绘制上限，复用背景；切到后台时停止绘制和轮询，打开信息面板时停止连续动画并降低同步频率，主动 Pause 时冻结自己的画面。系统设置“减少动态效果”时默认暂停。暂停不阻止其他访客操作。
- **连接提示**：左上角显示连接状态。连接断开时停用投喂、抓放等共享操作，等待重新连接并同步；界面不会以本地假状态继续更改共享世界。

这些逻辑都运行在现有 FastAPI 服务中，无新增服务、框架、依赖或 Nginx 配置。**Uvicorn 必须保持 1 个 worker**，不能通过多进程或多实例同时写同一牧场。已有服务器必须更新完整 `app/` 后重启，不能只换 HTML 和静态文件。

## 本地启动

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

访问 http://127.0.0.1:8000 。`--reload` 仅用于开发。

## 修改品牌、产品与联系方式

首次启动时，`data/site.json` 仅作为初始化资料导入 SQLite。数据库一旦初始化，编辑此 JSON 不会自动覆盖数据库。日常修改请使用下文导出、编辑、导入流程。字段说明：

- `brand`：品牌英文名，当前为 PERSONAL SHOPPER。
- `about`：游戏内 About & contact 面板的个人介绍。`hero_title`、`hero_note` 为兼容旧资料保留，当前满屏首页不再展示旧版主标题区。
- `contact.email` / `phone` / `wechat` / `address`：填写实际联系方式，空值不展示。邮箱和电话填写后自动生成可点击链接。
- `products`：默认是八类采购方向，作为需求示例展示；也可维护自己的产品资料。每条需要唯一的英文 `slug`（小写字母、数字、短横线）、名称、分类、简介、介绍、图片字段及规格。
- `image`：图片可选。文件放到 `app/static/images/`，填 `/static/images/product.webp` 这样的本站路径。留空时首页显示文字卡片，详情页显示“SOURCING ON REQUEST”品类封面。
- `demo`：当前默认为 `false`；设为 `true` 时，品类详情页会显示“Category overview only. Availability is confirmed for each request.”提示。

推荐 WebP 图片，宽度约 1000px，尽量每张 100–250KB。不要把原始大图和视频堆进服务器。数据库内容导入或模板修改后需重启服务。本地开发使用 `data/site.sqlite3`；systemd 生产服务使用 `/var/lib/personal-shopper/site.sqlite3`，由 StateDirectory 自动创建可写目录。数据库及备份不提交 GitHub。

## Ubuntu 24.04 部署

以下假设站点安装到 `/opt/personal-shopper`，使用系统的 `www-data` 低权限账号运行。Nginx 配置按单域名独立站编写，已有站点的机器应保留原配置。

1. 安装环境：

```sh
sudo apt update
sudo apt install -y python3 python3-venv nginx git
```

2. 从公开仓库克隆（使用 HTTPS，无需配置 GitHub SSH 密钥）：

```sh
sudo mkdir -p /opt/personal-shopper
sudo chown "$(id -un):$(id -gn)" /opt/personal-shopper
git clone https://github.com/mooooooood/personal-shopper.git /opt/personal-shopper
cd /opt/personal-shopper
python3 -m venv .venv
.venv/bin/pip install --no-cache-dir -r requirements.txt
cp .env.example .env
nano .env
```

将 `.env` 的 `SITE_URL` 改为正式网址，例如 `https://shop.your-domain.com`。systemd 会加载此文件，本地直接运行 Uvicorn 不会自动加载它。若不配置域名，首页仍可运行，但不会输出 canonical / sitemap。

3. 首次部署前修改 `data/site.json`，填写联系方式及真实产品资料，加入图片。已有数据库时请改用下文导入流程。确保 `/opt/personal-shopper` 及内部文件对 `www-data` 可读，目录可遍历（常规目录 755、公开站点文件 644）；不需要把源码写权限给 Web 服务。

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

在云服务器安全组放行 80 和 443；保留已有 SSH 管理端口。8000 只监听本机，无需向公网开放。询价工具在浏览器内生成消息，由买家复制或通过邮件客户端发送，不自动提交或存储询价；网站没有付款功能。

6. 为已经解析到本机的域名启用 HTTPS：

```sh
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的真实域名
sudo certbot renew --dry-run
```

按提示填写证书联系邮箱并完成 HTTPS 配置；证书命令需要联网、域名正确解析且 80 端口可达。

## 1GB 服务器运行设置

- Uvicorn **必须固定 1 worker**：共享牧场依赖一个进程内的唯一状态，多 worker 或多实例会产生冲突，不能以此扩容。并发上限 40，超出可能返回 503，可根据实际流量调整。
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

先按下文备份 SQLite 数据库及产品图片。切换代码版本前记录 `git rev-parse HEAD`。将运行时配置 `.env` 留在服务器，不提交到 GitHub。

```sh
cd /opt/personal-shopper
git pull --ff-only
.venv/bin/pip install --no-cache-dir -r requirements.txt
sudo systemctl restart personal-shopper
curl -f http://127.0.0.1:8000/healthz
```

数据库位于代码目录之外，正常拉取代码不会覆盖它；JSON 只用于第一次初始化。如果改过源码或初始化资料，先保存/提交这些修改再合并，不要强制覆盖。回滚时切回已记录的提交，重新安装对应依赖并重启。

## 验证

```sh
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -v
```

Python 测试覆盖首页、详情页、健康检查、静态资源、安全响应头、资料导入与迁移，并验证服务器统一牧场模型、共享状态接口和 SQLite 持久化行为。牧场模型还验证随机毛色、野生动物来访、共享篮子保护、最低留存数量，以及旧存档迁移与恢复。

可选：使用 Node.js 22.7 或更新版本运行前端状态辅助函数的开发测试（生产服务器不需要安装 Node.js）：

```sh
node --test tests/*.test.mjs
```

Node 测试验证前端共享状态辅助函数和跳跃姿态，包括毛色与事件一致性、位置插值、动停收尾、跳跃周期连续与静止落地。兔子的实际模拟逻辑在 Python 中，由 Python 测试验证。浏览器只负责同步、绘制和提交操作。

## 代码托管与网站部署的区别

GitHub 公开仓库保存代码，仓库首页展示这份 README。FastAPI 网站按上面的步骤在服务器运行。仓库地址是 https://github.com/mooooooood/personal-shopper 。

## 官方参考

- https://fastapi.tiangolo.com/deployment/concepts/
- https://www.uvicorn.org/settings/


## 已部署旧版：升级到 SQLite

先保留服务器上已修改的 `data/site.json`（首次迁移的数据来源），再拉取或上传新版代码。不要用仓库默认资料覆盖自己的资料。然后执行：

```sh
cd /opt/personal-shopper
sudo cp deploy/personal-shopper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart personal-shopper
curl -f http://127.0.0.1:8000/healthz
```

服务会自动创建 `/var/lib/personal-shopper`、建表并导入当前 JSON。已有 SQLite 数据会保留。无需 `pip install sqlite3`，Python 自带该模块。系统命令行 `sqlite3` 是可选工具。

## SQLite 内容管理

网站资料使用 `site_settings`（品牌和联系方式）与 `products`（按 slug 和显示顺序存储产品）表，详细文本和规格以 JSON 保存在表内。共享牧场另用同一数据库中的 `meadow_state` 表，由服务器自动维护。网站资料没有公开修改接口或管理后台，仍通过服务器终端维护；公开的牧场交互接口只用于投喂、捕捉与放回兔子。

下方 JSON 导出/导入流程只管理网站资料，不编辑或重置共享牧场。SQLite 整库备份则包含网站资料和牧场存档。

生产环境先导出当前内容到一个尚不存在的文件：

```sh
cd /opt/personal-shopper
sudo -u www-data .venv/bin/python -m app.database --database /var/lib/personal-shopper/site.sqlite3 export /var/lib/personal-shopper/edit.json
sudo nano /var/lib/personal-shopper/edit.json
```

编辑后先备份，再导入（导入会整体替换品牌、联系方式及产品列表，不是增量合并）：

```sh
sudo -u www-data .venv/bin/python -m app.database --database /var/lib/personal-shopper/site.sqlite3 backup /var/lib/personal-shopper/before-edit.sqlite3
sudo -u www-data .venv/bin/python -m app.database --database /var/lib/personal-shopper/site.sqlite3 import /var/lib/personal-shopper/edit.json
sudo systemctl restart personal-shopper
```

每次导出和备份换一个新文件名，工具会拒绝覆盖已有文件。导入先验证字段、唯一产品标识和图片路径，并在一个事务内执行，失败会回滚。

本地开发无需指定数据库路径，例如：

```sh
.venv/bin/python -m app.database export /tmp/shop-edit.json
# 编辑 /tmp/shop-edit.json 后：
.venv/bin/python -m app.database import /tmp/shop-edit.json
```

重启本地 Uvicorn 后显示更新内容。`.env` 不会自动被这些终端命令加载，生产命令务必保留 `--database` 参数。

## 数据恢复

备份使用 SQLite backup API，可在网站运行时执行。定期将备份文件和图片另存到服务器之外；备份也占磁盘，应按需保留。

需要恢复时，停止网站，先为当前数据保留副本，再用已验证备份替换数据库：

```sh
sudo systemctl stop personal-shopper
sudo cp -p /var/lib/personal-shopper/site.sqlite3 /var/lib/personal-shopper/site-before-restore.sqlite3
sudo cp /var/lib/personal-shopper/before-edit.sqlite3 /var/lib/personal-shopper/site.sqlite3
sudo chown www-data:www-data /var/lib/personal-shopper/site.sqlite3
sudo systemctl start personal-shopper
curl -f http://127.0.0.1:8000/healthz
```

当前实现使用 SQLite 默认回滚日志模式；不要自行改变日志模式后继续照搬文件恢复步骤。恢复前的副本也应选未使用过的文件名。



## 当前定位：面向海外买家的中国商品代购

满屏共享牧场保留一个 **About & contact** 入口，在面板内以简短英文介绍个人代购及商业采购。家居、服饰、电子、户外、乐器、工具、礼品与商业采购是示例方向，并非限制清单。采购分类和轻量询价消息生成器折叠放置，关闭面板即可回到游戏。

询价区域不会上传数据、保存订单或自动发邮件。买家填写需求后生成可编辑的消息，复制发送；配置邮箱后可打开邮件客户端。图片通过联系渠道另行提供，不是网站上传功能。请务必配置真实联系方式再对外推广。

### 从旧版升级（此次不能只更新模板和 static）

**共享牧场版本包含 Python 模型、HTTP 接口和 SQLite 存档逻辑，本次随机毛色与老鹰、灰狼事件也需要更新后端。必须覆盖完整 `app/` 并重启服务；只更新模板和 static 不会启用完整功能。** 下列命令同时更新旧版本可能需要的两个 JSON 种子文件，适用于项目位于 `/opt/personal-shopper` 的服务器。按用户偏好不备份旧代码，保留数据库、环境配置及额外图片：

```sh
shop_update_dir=$(mktemp -d /tmp/shop-update.XXXXXX)
git clone https://github.com/mooooooood/personal-shopper.git "$shop_update_dir"
sudo cp -a "$shop_update_dir/app/." /opt/personal-shopper/app/
sudo cp "$shop_update_dir/data/site.json" "$shop_update_dir/data/legacy-site.json" /opt/personal-shopper/data/
sudo systemctl restart personal-shopper
```

不要删除 `/var/lib/personal-shopper/`、现有 SQLite 文件或 `.env`。现有 SQLite 数据库才是运行中的资料来源，JSON 是默认内容来源。若从未启用 SQLite 且只修改过 JSON，先将自定义资料导入数据库再升级种子文件。

首次启动会运行一次 `sourcing-v1` 内容迁移：仅替换仍与旧版默认内容完全相同的文案与三条演示产品；保留已修改的联系方式、品牌和自定义产品，加入八个通用品类。迁移有事务保护并记录执行标志，后续启动不会重复添加；保留下来的自定义中文资料需自行翻译。全新数据库直接使用英文默认内容。

重启后服务会自动创建或读取 `meadow_state` 共享存档。旧牧场存档会自动补充毛色与随机来访状态，已有白兔仍保持白色，新生兔子随机获得毛色，无需清空数据库或重开牧场；网站的现有品牌、介绍、联系方式和产品资料保留。原依赖、systemd 与 Nginx 配置无需变更，但须确认 Uvicorn 仍只有 1 个 worker。静态资源版本已更新，刷新浏览器即可加载新画面。


## 个人品牌定位：一人公司 / 独立采购贸易

网站使用第一人称介绍经营者：一位在中国独立经营、从供应商采购并向海外转售的贸易中间商。游戏里的业务面板说明直接沟通、灵活采购、利润与报价，以及每单确认国际运输。没有虚构团队、工厂、履历、客户数量、姓名或肖像。

个人故事来自 SQLite 的 `about`，`data/site.json` 仅用于首次初始化。旧 `hero_title`、`hero_note` 字段继续保留，但不再占据游戏画面。真实姓名未提供时，以 PERSONAL SHOPPER 品牌和第一人称介绍；联系方式仍来自原数据库。想修改介绍时，按上文 SQLite 导出、编辑、导入后重启。

升级仍按上一节的方式覆盖 `app/` 和两个 JSON 文件，再重启服务。新增 `solo-v1` 一次性迁移，仅更新未经修改的上一版默认文案与默认产品说明，保留自定义简介、联系方式和产品。无需安装新依赖。数据迁移和资料保留由 Python 测试验证。
