# DSH 模型能力查询台

一个**单文件、离线可用**的 DeepSeek Harness（DSH）模型能力速查页面：把本机网关里的全部模型按能力打分、排序，并附真实连通性/速度实测快照。

![screenshot](https://img.shields.io/badge/models-280-blue) ![screenshot](https://img.shields.io/badge/channels-23-blue) ![screenshot](https://img.shields.io/badge/probe-2026--10--13-green)

## 这是什么

[DeepSeek Harness](https://github.com/deepseek-ai) 配合 [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) 等免费模型插件后，本机 8326 网关会聚合几十个渠道、上百个模型。这个页面把它们整理成一张可筛选、可排序、可导出的速查表：

- **能力分**（满分 100）＝ 家族档位(轻量30/标准42/高配56/旗舰70) + 图片6 + 音频2 + 上下文≤14 + 推理≤8；上下文未声明的模型给中性 6 分，不奖不罚
- **实测列**：来自真实请求快照（每个模型发一条 `max_tokens=1` 的最小请求），连通=HTTP 200，思考型模型正文为空也算连通
- **一键复制配置**：每行一个按钮，生成 Codex/CLI 直连本机网关的配置片段
- **CSV 导出**（带 BOM，Excel 直接打开不乱码）

页面功能：

| 功能 | 说明 |
|---|---|
| 来源筛选 | 上下文数据的来源（官方元数据 / 调研补全 / 家族参考 / 未声明） |
| 实测筛选 | 只看连通 / 只看失败 / 未测 |
| 思考档位 | reasoning effort 支持情况的完整链路 tooltip |
| 键盘流 | `/` 聚焦搜索，`Esc` 清空 |
| 持久化 | 筛选状态与网关密钥存 localStorage，刷新不丢 |

## 怎么用

1. 下载 `DSH-模型能力查询台.html`，双击用浏览器打开（`file://` 即可，无需服务器）
2. 页面顶部填入你本机网关的密钥（DSH 设置页 → 本地网关可见；只存在你浏览器的 localStorage，**不会上传到任何地方**）
3. 「开始测速」可对你的网关做一轮实时测速；不测也能看内置快照

> 打开时页面里**没有预置任何密钥**。`DEFAULT_KEY` 为空串，测速前需要你自己填。

## 数据口径

- 上下文/最大输出：纯数字 tokens；优先官方元数据，缺了用调研补全（`ctx-override.json`），再按模型家族参考推算，最后才是"未声明"
- 实测快照：`probe-results.json`，每条含 HTTP 状态、首字延迟、速率
- 免费标记：cline 渠道只展示免费档

## 自己重新生成

```sh
# 1. 拉取本机网关的模型清单
node save-models.js          # -> chan-models.json

# 2. 连通性实测（8 并发，约 2 分钟）
node probe.js                # -> probe-results.json

# 3. 生成页面
node gen-html.js             # 本机版（内嵌你自己的网关默认密钥）
node gen-html.js --publish   # 发布版（绝不内嵌密钥）
```

脚本默认从 `%USERPROFILE%\.dsh\openai-gateway\api-key` 读密钥；发布模式不会读、也不会写进产物。

## 隐私说明

- 仓库内所有文件**不含**任何 API 密钥、本机用户名、绝对路径（生成脚本里的密钥路径都是 `%USERPROFILE%` 相对形式）
- 页面测速是你浏览器 → 你本机网关的本地请求，数据不出机器
- 仓库里的实测快照是生成那一刻的通道健康状况，仅供参考

## 更新记录

- **2026-10-13**：模型 215→280、渠道 18→23（trae/trae-global/internai/sensenova/deepseek 等新渠道接入）；连通性快照刷新（连通 166 / 最快 236ms）
- **2026-10-12**：快照刷新
- **2026-10-10**：布局防塌（窄屏模型列永不隐藏）、来源筛选、复制配置、CSV 导出
- **2026-10-09**：初版（215 模型 / 18 渠道）

## License

MIT
