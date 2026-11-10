package app.clonespace.data

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class Space(val id: Int, val name: String)

/** Per-clone user settings: custom name, badge colour, notification label. */
data class CloneMeta(
    val customName: String? = null,
    /** ARGB badge colour for the icon badge, null = default. */
    val badgeColor: Int? = null,
    /** Shown as sub text on the clone's notifications. Null = use the space name. */
    val notificationLabel: String? = null,
)

/** Spaces and per-clone metadata, in one small JSON file. Only the UI process writes it. */
class MetaStore(private val file: File) {
    private var spaces: MutableList<Space> = mutableListOf()
    private var meta: MutableMap<String, CloneMeta> = mutableMapOf()
    private var loaded = false

    @Synchronized private fun load() {
        if (loaded) return
        loaded = true
        try {
            if (!file.isFile) return
            val o = JSONObject(file.readText())
            val sp = o.optJSONArray("spaces") ?: JSONArray()
            for (i in 0 until sp.length()) sp.getJSONObject(i).let { spaces += Space(it.getInt("id"), it.getString("name")) }
            val m = o.optJSONObject("meta") ?: JSONObject()
            for (k in m.keys()) {
                val c = m.getJSONObject(k)
                meta[k] = CloneMeta(
                    c.optString("customName").ifEmpty { null },
                    if (c.has("badgeColor")) c.getInt("badgeColor") else null,
                    c.optString("notificationLabel").ifEmpty { null },
                )
            }
        } catch (_: Exception) {
            spaces = mutableListOf(); meta = mutableMapOf()
        }
    }

    @Synchronized private fun save() {
        val o = JSONObject()
        o.put("spaces", JSONArray().also { a -> spaces.forEach { a.put(JSONObject().put("id", it.id).put("name", it.name)) } })
        o.put("meta", JSONObject().also { m ->
            meta.forEach { (k, v) ->
                m.put(k, JSONObject().apply {
                    v.customName?.let { put("customName", it) }
                    v.badgeColor?.let { put("badgeColor", it) }
                    v.notificationLabel?.let { put("notificationLabel", it) }
                })
            }
        })
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(o.toString())
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }

    @Synchronized fun spaces(): List<Space> { load(); return spaces.sortedBy { it.id } }

    @Synchronized fun spaceName(id: Int): String { load(); return spaces.firstOrNull { it.id == id }?.name ?: defaultName(id) }

    /** Adds a space with the next free id and returns it. */
    @Synchronized fun addSpace(name: String? = null): Space {
        load()
        val id = (spaces.maxOfOrNull { it.id } ?: -1) + 1
        return Space(id, name?.takeIf { it.isNotBlank() } ?: defaultName(id)).also { spaces += it; save() }
    }

    /** Makes sure the engine's spaces all have a name here. */
    @Synchronized fun adopt(ids: Collection<Int>) {
        load()
        var changed = false
        for (id in ids) if (spaces.none { it.id == id }) { spaces += Space(id, defaultName(id)); changed = true }
        if (changed) save()
    }

    @Synchronized fun renameSpace(id: Int, name: String) {
        load()
        val i = spaces.indexOfFirst { it.id == id }
        if (i >= 0 && name.isNotBlank()) { spaces[i] = spaces[i].copy(name = name.trim().take(24)); save() }
    }

    @Synchronized fun removeSpace(id: Int) {
        load()
        spaces.removeAll { it.id == id }
        meta.keys.filter { it.startsWith("$id:") }.forEach { meta.remove(it) }
        save()
    }

    @Synchronized fun meta(space: Int, pkg: String): CloneMeta { load(); return meta["$space:$pkg"] ?: CloneMeta() }

    @Synchronized fun setMeta(space: Int, pkg: String, m: CloneMeta) {
        load()
        if (m == CloneMeta()) meta.remove("$space:$pkg") else meta["$space:$pkg"] = m
        save()
    }

    @Synchronized fun removeMeta(space: Int, pkg: String) { load(); meta.remove("$space:$pkg"); save() }

    companion object {
        fun defaultName(id: Int) = "Space ${id + 1}"
    }
}
