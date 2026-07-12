# Remaining Gaps and Placeholder Audit

核验日期：2026-07-11。

| 模块 | 功能 | 状态 | 是否真实可用 | 剩余问题 | 原因 | 用户影响 | 解决方式 |
|---|---|---|---|---|---|---|---|
| 地图/地址 | 搜索、反向解析、点击、拖动、保存回读 | COMPLETED | 是 | Photon/OSM 公共服务无 SLA | 公共基础设施 | 服务故障时只能保留坐标 | 生产自托管或换有 SLA 服务 |
| 定位 | 浏览器定位 | PARTIAL | 代码可用 | 本轮未完成真机授权成功/拒绝/超时三路径 | 自动化环境未触发真实设备权限 | 用户仍可搜索或地图选点 | 真机补验三路径 |
| 天气 | Open-Meteo 7 天逐小时 | COMPLETED | 是 | 预报本身存在误差 | 数值预报局限 | 由 BOM 实况校正当前数小时 | 保持多源比较 |
| 官方潮汐 | MSQ/BOM 参考港年度导入 | PARTIAL | Gold Coast 2026 可用 | 其他州/年份未导入，无年度调度 | 官方文件分州分格式 | NSW 等点无官方潮汐评分 | 增加州级解析器和年度任务 |
| EOT20 | 经纬度本地模型 | BLOCKED | 否 | 缺 2.3 GB 模型 NetCDF | 模型不随 eo-tides 分发 | UI 显示 UNAVAILABLE，绝不生成假值 | 按 `check-eot20.ps1` 安装并挂载模型 |
| 双潮汐 | 三模式/评分源选择/快照 | PARTIAL | UI 与持久化可用 | EOT20 不可用时无法产生真实差异 | 模型文件缺失 | 只能比较结构，不能报告数值差 | 安装模型后真实复测 |
| BOM 警告 | RSS 解析、展示、安全 UNKNOWN/硬阻断 | PARTIAL | 是（州/标题区域） | CAP 几何、精确有效期/Marine Zone 未完成 | RSS 字段粒度 | 必须打开 BOM 原文核实 | 接 CAP/GIS zone 并做精确时空匹配 |
| BOM 实况 | 10 分钟 XML、候选站、当前评分 | PARTIAL | 是 | 地形相似性排序和候选管理 UI 有限 | 元数据不足 | 近站不一定代表岸边 | 增加站点分类和管理员审查 |
| BOM 海域预报 | 官方区域文字第二意见 | PARTIAL | Sydney 可用 | 全国区域/产品映射不完整；Gold Coast `.txt` 当前 404 | 产品分州维护 | 部分地点无官方第二意见 | 建立官方 zone/product 更新表 |
| Marine 适用性 | 网格距离/水域规则/评分退出 | COMPLETED | 是 | 规则仍是初始启发式 | 无局地校准 | 港湾数据保守降级 | 结合实钓和本地观测校准 |
| NSW MHL 海浪 | 外海浮标观测 | DEFERRED | 否 | Provider 未实现 | 本轮未完成 | 没有实际波浪第二意见 | 接 NSW MHL 官方开放数据 |
| 河流水文 | Brooklyn/Hawkesbury 水位流量 | BLOCKED | 否 | BOM SOS2 本次 HTTP 500；未接 WaterNSW station | Provider 当前限制/尚未完成替代 | 只显示本地点位降雨，不能显示河位趋势 | 缓存式接 SOS2 或 WaterNSW |
| 本地天文 | 日出日落/晨昏/月相 | COMPLETED | 是 | 月相未校准 | 样本不足 | 月相权重为 0 | 用历史样本验证后再调整 |
| 实钓 | 基础保存、历史、预测快照关联 | PARTIAL | 是 | 详细装备/船流/人流/尺寸字段未全部实现 | 表单仍是 MVP | 不能做完整因果分离 | 扩展 migration、表单和对比分析 |
| 收藏比较 | 横向排序页面 | DEFERRED | 否 | 未实现 | 本轮范围未完成 | 用户需逐点查看 | 增加 compare API/UI |
| 法规 | 官方州入口 | DEFERRED | 否 | 未实现 | 需持续核验 | 不声明地点一定可钓 | 接州级官方入口和核验日期 |
| 系统状态 | Provider/缓存/DB/模型/错误 | COMPLETED | 是 | 后台年度任务显示 NOT_IMPLEMENTED | 未建 scheduler | 需手动潮汐导入 | 加年度检查任务 |
| Docker | 构建、启动、迁移、导入、重启持久化 | COMPLETED | 是 | EOT20 卷为空 | 外部模型未安装 | 模型状态 DISABLED | 挂载模型目录 |

生产代码没有 TODO/FIXME/HACK/placeholder 潮汐或模拟天气。`null` 仅表示领域字段确实缺失，并通过 `missing`、Provider 状态或 UNAVAILABLE reason 向 UI 解释；仍存在的功能缺口均在上表明示。
