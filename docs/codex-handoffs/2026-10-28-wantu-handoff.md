# 弯兔（onetwo）项目交接

## 项目位置与目标

- 工作目录：`/Users/Zhuanz/Desktop/朋友圈美化`
- 项目：微信小程序「弯兔 onetwo」；定位是把用户照片制作成白色手写注释风格 PLOG。
- 品牌：黄 `#FFE25A` + 深蓝为主，兔子为弯曲/歪脖造型；宣传语为「一弯，就有趣。」
- 用户喜欢可爱、女性向、卡片化的首页，不希望页面死板或颜色过多。

## 当前已完成的产品功能

1. 首页为功能卡片横向滑动，当前主功能是「照片手账」；用户点击「弯一下」后选照片。
2. 选图后进入编辑/生成页；现在先显示生成过渡层，不会选图即扣费。
3. 生成成功后可保存到相册；「我的作品」可查看、下载，长按删除。
4. 次数页包含 3 次 ¥2.9 体验包、10 次 ¥9.9、30 次 ¥24.9；支付云函数及回调代码存在，但正式微信支付仍需按 README 配置、联调。
5. 当前正式出图模型为火山引擎 `doubao-seedream-5-0-pro-260628`（Seedream 5.0 Pro）。用户已手动验证出图成功，接受较长生成时间。

## 当前出图架构（请不要改回同步调用）

旧的同步方舟调用会在微信云函数约 60 秒的执行时限内超时。现在必须保留异步架构：

1. 云函数上传照片并用千问视觉模型提取照片内可见事实。
2. 云函数经 **AI MediaKit** 提交 Seedream 异步任务。
3. 小程序每 2.5 秒轮询云函数；云函数再查询 AI MediaKit 任务状态。
4. 完成后云函数将成图保存到 CloudBase，才扣除生成次数、写入作品记录，并返回成图 Cloud File ID。

相关文件：

- `cloudfunctions/generatePlog/index.js`：核心生成、轮询、额度和作品记录逻辑。
- `pages/editor/editor.js`：上传、提交、轮询、保存相册及生成中 UI。
- `pages/editor/editor.wxml` / `pages/editor/editor.wxss`：生成中遮罩与文案样式。
- `cloudfunctions/README.md`：云函数、支付、回调部署说明。
- `docs/ai-plog-generation-spec.md`：成图效果要求。

## 已锁定的生成约束

- 模型必须使用：`doubao-seedream-5-0-pro-260628`。
- 画幅保持输入照片比例；请求尺寸为 `1.5K`。
- 提示词必须沿用用户提供的核心要求：白色细线、物体轮廓、箭头/虚线/弧线、自然中文手写短句、少量小涂鸦、不要遮挡主体、Instagram 故事感 + 杂志手写笔记风。
- 文案必须贴合照片中可见的对象、动作、颜色或光影；不要写「生活照片、认真记录、这一刻很好、小小发现、留在今天」等泛用句。
- 用户明确要求：不再做成图乱码检查/拦截；即使文字有小瑕疵，也展示给用户。不要恢复 `inspectGeneratedPlog` 检查流程。
- 不要在生成结果上用前端固定文字或字体覆盖替换 AI 生成文字；用户要的是原生手写感。

## 已解决的问题与关键配置

### AI MediaKit

当前异步路径为：

- 提交：`POST https://mediakit.cn-beijing.volces.com/api/v1/tools/call-maas-proxy`
- 任务查询：`GET https://mediakit.cn-beijing.volces.com/api/v1/tasks/{task_id}`
- API 参数：`api: 'ark.image_generation'`

云函数环境变量必须存在：

- `MEDIAKIT_API_KEY`：只能填 AI MediaKit 创建的 API Key，**不能**填火山方舟 ARK Key。
- `DASHSCOPE_API_KEY`：用于千问视觉事实识别，不能删除。

AI MediaKit 还必须在「基础配置 → 授权管理」完成跨服务授权，创建/授权 `AmkServiceLinkedRole`。此前报错 `RoleNotExist`，用户已完成授权并生成成功。不要再让用户把完整密钥发到聊天；若密钥曾暴露，应提醒立即删除/轮换。

### 费用认知

AI MediaKit 的 `ark.image_generation` 代理本身不额外按次收费；Seedream 模型费用仍由火山方舟计费。当前 1.5K 成图成本约按 Seedream Pro 价格表计，实际以火山方舟控制台账单为准。不要把 MediaKit 误说成免费出图模型。

## 本轮刚完成、尚需用户重新编译验证的改动

编辑页新增了生成中的动态等待反馈，代码已在本地修改并通过：

```bash
node --check pages/editor/editor.js
```

效果：

- 初始提示「通常需要约 40–90 秒，请保持页面打开」。
- 12 秒后提示正在分析照片、构思手写文字和涂鸦。
- 45 秒后显示已创作秒数。
- 80 秒后提示正在做最后细节，避免用户误以为卡住。

当前变更只涉及小程序前端文件，因此用户需要在微信开发者工具中重新编译/预览；无需为这项 UI 改动单独重部署云函数。

## 继续前先做的检查

1. 读本交接文档及 `cloudfunctions/README.md`。
2. 检查工作区现有文件，保留用户已有修改，不要用 reset/checkout 覆盖。
3. 用户在开发者工具重新编译后，使用一张照片完整测试：选图 → 点击「开始弯」→ 等待提示变化 → 成图 → 保存相册 → 我的作品查看/删除。
4. 确认生成成功只扣 1 次，失败不扣次数，且轮询结束后不再继续请求。
5. 如果报错，先要求用户提供云函数日志中完整错误文字（不含任何 Key），再定位；不要猜测。

## 后续优先事项（按顺序）

1. 验证本轮的动态等待提示是否在真机/预览中正常显示，文案是否符合用户感受。
2. 验证一次完整出图与次数扣减闭环。
3. 只有用户明确要求时，再做首页新增功能卡片或支付正式联调。
4. 支付上线前，严格按 `cloudfunctions/README.md` 和 `scf/payment-notify-web/README.md` 配置微信支付商户、回调和订单集合；不要假设“弹二维码”就是正式支付完成。

## 常用验证命令

```bash
node --check cloudfunctions/generatePlog/index.js
node --check pages/editor/editor.js
```

项目不是 Git 仓库；不要依赖 `git diff` 或执行任何 Git 覆盖操作。
