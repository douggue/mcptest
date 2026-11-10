package app.clonespace

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import app.clonespace.data.CloneItem
import app.clonespace.data.ShortcutParser

/** Home-screen shortcuts: build them, and parse them back with strict validation. */
object ShortcutSupport {
    fun uriFor(spaceId: Int, pkg: String): Uri = Uri.parse(ShortcutParser.format(spaceId, pkg))

    fun canPin(ctx: Context) = ShortcutManagerCompat.isRequestPinShortcutSupported(ctx)

    fun requestPin(ctx: Context, item: CloneItem, icon: Bitmap?): Boolean {
        val label = item.displayName + if (item.number > 1 || item.spaceId > 0) " · ${item.spaceName}" else ""
        val intent = Intent(Intent.ACTION_VIEW, uriFor(item.spaceId, item.packageName), ctx, ShortcutActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val badged = icon?.let { withBadge(it, item.number, item.meta.badgeColor) }
        val b = ShortcutInfoCompat.Builder(ctx, item.key).setShortLabel(label.take(24)).setLongLabel(label).setIntent(intent)
        if (badged != null) b.setIcon(IconCompat.createWithBitmap(badged))
        return ShortcutManagerCompat.requestPinShortcut(ctx, b.build(), null)
    }

    /** Draws the clone-number badge onto the icon, like the badge in the app grid. */
    fun withBadge(src: Bitmap, number: Int, color: Int?): Bitmap {
        val size = maxOf(src.width, 96)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        c.drawBitmap(Bitmap.createScaledBitmap(src, size, size, true), 0f, 0f, null)
        val r = size * 0.19f
        val cx = size - r - 2f; val cy = size - r - 2f
        c.drawCircle(cx, cy, r, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color ?: 0xFFC2410C.toInt() })
        val t = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = 0xFFFFFFFF.toInt(); textSize = r * 1.25f; textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD
        }
        c.drawText(number.toString(), cx, cy - (t.ascent() + t.descent()) / 2f, t)
        return out
    }
}
