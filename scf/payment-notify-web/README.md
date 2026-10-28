# 微信支付回调 Web 函数

这是一个部署到腾讯云 SCF「Web 函数」的独立 HTTPS 回调服务，不部署到 CloudBase 的普通云函数。

## 路径

- 健康检查：`GET /healthz`
- 微信支付通知：`POST /wechatpay/notify`

## SCF 环境变量

所有变量都在腾讯云 SCF 的环境变量中配置，绝不提交到代码或发送到聊天：

| 名称 | 值 |
| --- | --- |
| `CLOUDBASE_ENV_ID` | `cloud1-d7guqbh1xf32265fb` |
| `WECHAT_MINIPROGRAM_SECRET` | 小程序 AppSecret（只填 SCF，不要发给任何人） |
| `PAYMENT_CALLBACK_SECRET` | 随机强密钥；SCF 与 CloudBase `payment` 云函数必须填写相同值 |
| `WECHATPAY_APPID` | 小程序 AppID |
| `WECHATPAY_MCHID` | 微信支付商户号 |
| `WECHATPAY_API_V3_KEY` | 32 位 APIv3 密钥 |
| `WECHATPAY_PLATFORM_PUBLIC_KEY_ID` | 微信支付平台公钥 ID |
| `WECHATPAY_PLATFORM_PUBLIC_KEY_BASE64` | 微信支付平台公钥 PEM 的 Base64 单行内容 |

部署成功后，将函数 URL 加上 `/wechatpay/notify` 写入 CloudBase `payment` 云函数的 `WECHATPAY_NOTIFY_URL`。

这个方案不需要 CloudBase 服务端 API Key：SCF 先完成微信支付验签和 AES-GCM 解密，再通过小程序官方 HTTP API 调用 `payment` 云函数，由云函数在现有环境内完成订单幂等入账。
