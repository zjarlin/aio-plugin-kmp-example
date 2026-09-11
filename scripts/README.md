# 构建脚本

`generate-bindings.sh` 固定 WIT 到 Kotlin 绑定参数，`build-component.sh` 负责 Toolchain 构建、Component 封装和验证。

`test-workbench.mjs` 验证 Compose + Ktor 任务 CRUD，并在桌面/移动端断网点击本地计数器 20 次，断言无请求、真实重绘、切换标签保留状态、重新加载归零。`test-browser.mjs` 独立验证 Component 页面调用数据库与刷新持久化，二者不混用。
