package site.addzero.aio.example.counter

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import site.addzero.aio.example.bindings.Host
import site.addzero.aio.example.bindings.Metadata
import site.addzero.aio.example.bindings.PluginRootFunctions
import site.addzero.aio.example.bindings.Transport

internal object PluginRootFunctionsExportsImpl : PluginRootFunctions.Exports {
    override fun describe() = Metadata.Description(
        "KMP Counter",
        listOf(Metadata.PageDefinition(
            "counter", "KMP Counter", "counter.html",
            Metadata.Scene("community", "社区插件"), emptyList(), null,
            Metadata.Surface.WORKSPACE,
        )),
    )

    override fun health() = Result.success(Unit)

    override fun lifecycle(phase: Transport.Phase) = Result.success(Unit)

    override fun handle(request: Transport.Request): Transport.Response {
        if (request.path != "/counter") return response(404, "Not found")
        if (request.method != "GET" && request.method != "POST") return response(405, "Method not allowed")
        val tenant = Host.context().tenantId ?: return response(401, "Missing tenant context")
        return try {
            val count = counter(request.method == "POST")
            response(200, Json.encodeToString(CounterResponse(count, tenant)))
        } catch (cause: Throwable) {
            Host.log(cause.message ?: "Counter request failed")
            response(503, "Counter unavailable")
        }
    }

    private fun response(status: Int, body: String) = Transport.Response(
        status.toUShort(),
        listOf(Transport.Header("content-type", if (status == 200) "application/json" else "text/plain")),
        body.encodeToByteArray().map { it.toUByte() },
    )
}
