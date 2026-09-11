# 后端目标

`service/` 是 Ktor JVM HTTP 服务，根清单默认选择该目标。`component/` 是 Kotlin v2 Wasm Component，使用宿主数据库能力和 `migrations/`。两者是同一全栈示例的构建目标，不是两个独立插件；包只包含当前选择的后端及配套前端。
