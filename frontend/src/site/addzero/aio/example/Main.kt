@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

package site.addzero.aio.example

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.ComposeViewport
import kotlin.js.JsString
import kotlin.js.js

private fun initialScreen(): JsString = js("document.body.dataset.screen || 'tasks'")

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    val counter = initialScreen().toString() == "counter"
    ComposeViewport { if (counter) CounterPage() else WorkbenchPage() }
}
