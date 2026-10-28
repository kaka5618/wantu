# 云函数部署

环境 ID：`cloud1-d7guqbh1xf32265fb`

1. 在微信开发者工具资源管理器中，右键 `cloudfunctions/generatePlog`，选择“上传并部署：云端安装依赖”。
2. 在函数配置中保留环境变量 `DASHSCOPE_API_KEY`（用于照片事实识别），并新增 `MEDIAKIT_API_KEY`，填入 AI MediaKit 控制台创建的 API Key（用于异步提交并查询 Seedream 出图任务）。不要将密钥写入源码或发到聊天中。
3. 在函数配置中把执行超时设为体验版允许的最大值 `60` 秒。
4. 重新编译小程序。用户图片会先上传到云存储，再由云函数调用当前选定的 Seedream 5.0 Pro 模型生成 PLOG 成片；生成成图会自动转存到本环境云存储，确保可保存到相册。

## 当前出图模型

`generatePlog` 当前已锁定使用 `doubao-seedream-5-0-pro-260628`。不要新增或设置 `IMAGE_MODEL`；该变量不会作为切换入口。每次成功生成后，数据库 `plog_history` 的最新记录会写入实际请求的 `model` 字段，正常值必须是 `doubao-seedream-5-0-pro-260628`。

该方案使用 CloudBase 作为安全后端、阿里百炼用于照片事实识别、AI MediaKit 异步代理火山方舟 Seedream 用于出图；不需要购买 CloudBase 标准版。首次部署前，需在 AI MediaKit 控制台完成对火山方舟的跨服务授权，并创建 MediaKit API Key。生成图片的 URL 有效期有限，云函数会将其持久化到云存储。

## 产品反馈云函数

`feedback` 云函数接收用户的出图问题与功能建议，记录在 `plog_feedback` 集合。部署前请先在云开发数据库创建一个空的 `plog_feedback` 集合，并将权限设为“仅管理端可读写”；小程序通过云函数提交，用户无法读取其他人的反馈。

在微信开发者工具中右键 `cloudfunctions/feedback`，选择“上传并部署：云端安装依赖”。反馈可选附带最多 3 张截图，图片会保存到云存储，并只在该反馈记录中保留 File ID。

## 照片故事云函数

`generateStory` 是「照片故事」的独立异步出图函数，使用 AI MediaKit 提交并轮询 `doubao-seedream-5-0-pro-260628`。它与照片手账共用用户可用次数，但不修改 `generatePlog` 的出图流程。

部署前请在云开发数据库创建空集合 `story_history`，并将权限设为“仅管理端可读写”。然后右键 `cloudfunctions/generateStory`，选择“上传并部署：云端安装依赖”。该函数复用既有的 `MEDIAKIT_API_KEY` 环境变量；不要把密钥写进代码或发送到聊天。

## 小程序 UI 图片资源

大尺寸 UI 图片不要保存在小程序项目内。图片文件统一上传到云存储的 `ui-assets/` 路径，数据库使用 `ui_assets` 集合只保存文件 ID 和展示配置。请创建 `ui_assets` 集合并设为“仅管理端可读写”，然后部署 `uiAssets` 云函数。

照片故事封面使用以下记录格式，每张图一条，`sort` 越小越靠前：

```json
{
  "group": "story_cover",
  "enabled": true,
  "sort": 1,
  "title": "秋日大树",
  "fileId": "cloud://你的环境ID.ui-assets/story-covers/01-autumn-tree.jpg"
}
```

# 生成云函数

## 使用次数

`generatePlog` 首次被调用时，会在云开发数据库创建并使用 `plog_usage` 集合，以当前微信用户的 OpenID 记录成功出图次数。每个用户有 1 次免费生成；AI 请求失败不扣次数。

还需在数据库控制台创建空集合 `plog_history`。每次成功出图后，云函数会写入云存储文件 ID 和创建时间，用于“我的作品”页面回看。

## 微信支付云函数

`payment` 云函数用于服务端创建微信支付订单、查询支付结果，并在核验成功后给当前 OpenID 增加付费次数。部署前，先在云开发数据库创建空集合 `plog_orders`，然后在 `payment` 的云函数环境变量中配置：

| 环境变量 | 说明 |
| --- | --- |
| `WECHATPAY_MCHID` | 微信支付商户号 |
| `WECHATPAY_APPID` | 已关联的小程序 AppID |
| `WECHATPAY_SERIAL_NO` | 商户 API 证书序列号 |
| `WECHATPAY_PRIVATE_KEY_BASE64` | `apiclient_key.pem` 的 Base64 内容，绝不能写进代码或聊天 |
| `WECHATPAY_NOTIFY_URL` | 支付结果回调 HTTPS 地址；正式发布前必须配置并完成回调验签 |

当前前端在用户支付后会主动向微信支付查询交易状态，只有查询到 `SUCCESS` 并核对订单金额后才发放次数。正式发布前仍必须补齐独立的回调入口和验签，避免用户支付后立即退出小程序时无法及时到账。

# 支付回调（上线前必做）

当前 CloudBase 个人版没有 HTTP 访问服务，因此不能将 `paymentNotify` 作为公网回调部署。正式回调改为独立的腾讯云 SCF Web 函数，代码在项目根目录的 `scf/payment-notify-web`。

它会验签、解密支付通知、核对 AppID、商户号、订单号和金额，并以幂等事务增加用户次数；不要用客户端返回作为唯一发货依据。

部署 Web 函数并拿到函数 URL 后，将：

`https://你的函数URL/wechatpay/notify`

填入 `payment` 云函数环境变量 `WECHATPAY_NOTIFY_URL`。完整的环境变量和部署说明见 `scf/payment-notify-web/README.md`。

不要把 APIv3 密钥、公钥文件、商户私钥、CloudBase 服务端 API Key 或证书提交到代码仓库。

