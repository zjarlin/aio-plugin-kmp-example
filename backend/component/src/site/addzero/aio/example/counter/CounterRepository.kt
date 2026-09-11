package site.addzero.aio.example.counter

import site.addzero.aio.example.bindings.Database

internal fun counter(increment: Boolean): Long {
    val transaction = Database.begin().getOrThrow()
    try {
        val statement = if (increment) {
            "INSERT INTO counter(id, value) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET value = counter.value + 1 RETURNING value"
        } else {
            "SELECT value FROM counter WHERE id = 1"
        }
        val result = Database.query(transaction, statement, emptyList()).getOrThrow()
        val value = (result.values.firstOrNull()?.firstOrNull() as? Database.Value.Integer)?.value ?: 0L
        Database.finish(transaction, true).getOrThrow()
        return value
    } catch (cause: Throwable) {
        Database.finish(transaction, false)
        throw cause
    }
}
