package app.clonespace.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.clonespace.data.LeakStatus
import app.clonespace.ui.theme.Mono
import app.clonespace.ui.theme.tokens

@Composable
fun rememberBitmap(key: Any, loader: suspend () -> android.graphics.Bitmap?): ImageBitmap? {
    var bmp by remember(key) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(key) { bmp = loader()?.asImageBitmap() }
    return bmp
}

/** App icon: 56 dp rounded tile, optional clone-number badge at the bottom-right, optional warning mark. */
@Composable
fun IconTile(
    icon: ImageBitmap?,
    number: Int? = null,
    badgeColor: Color? = null,
    degraded: Boolean = false,
    degradedText: String = "",
    size: androidx.compose.ui.unit.Dp = 56.dp,
) {
    Box(Modifier.size(size + 8.dp)) {
        Box(
            Modifier.size(size).align(Alignment.TopStart).clip(RoundedCornerShape(16.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) { if (icon != null) Image(icon, contentDescription = null, modifier = Modifier.size(size)) }
        if (number != null) {
            Box(
                Modifier.align(Alignment.BottomEnd).size(22.dp).clip(CircleShape)
                    .background(badgeColor ?: MaterialTheme.tokens.badge)
                    .border(2.dp, MaterialTheme.colorScheme.background, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Text(number.toString(), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
        }
        if (degraded) {
            Icon(
                Icons.Filled.Warning, contentDescription = degradedText,
                tint = MaterialTheme.tokens.warning,
                modifier = Modifier.align(Alignment.TopEnd).size(18.dp)
                    .background(MaterialTheme.colorScheme.background, CircleShape),
            )
        }
    }
}

/** Status is never colour alone: icon + word + colour. */
@Composable
fun StatusTag(status: LeakStatus) {
    val t = MaterialTheme.tokens
    val (icon, word, color) = when (status) {
        LeakStatus.ISOLATED -> Triple(Icons.Filled.CheckCircle, "Isolated", t.success)
        LeakStatus.LEAK -> Triple(Icons.Filled.Warning, "Leak", t.warning)
        LeakStatus.SHARED -> Triple(Icons.Filled.Info, "Shared", MaterialTheme.colorScheme.onSurfaceVariant)
        LeakStatus.UNKNOWN -> Triple(Icons.Filled.Info, "Not tested", MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Row(
        Modifier.semantics { contentDescription = word }.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.12f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(icon, null, tint = color, modifier = Modifier.size(14.dp))
        Text(word, color = color, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
fun SectionCard(title: String? = null, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(20.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (title != null) Text(title, style = MaterialTheme.typography.titleSmall)
        content()
    }
}

@Composable
fun Banner(text: String, warning: Boolean = false, modifier: Modifier = Modifier) {
    val t = MaterialTheme.tokens
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(if (warning) t.warningSoft else t.accentSoft).padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top,
    ) {
        Icon(if (warning) Icons.Filled.Warning else Icons.Filled.Info, null, tint = if (warning) t.warning else MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
fun MonoText(text: String, modifier: Modifier = Modifier, maxLines: Int = 2) {
    Text(text, modifier, style = Mono, color = MaterialTheme.colorScheme.onSurface, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}

/** Dashed outline, used by the "New space" chip. */
fun Modifier.dashedBorder(color: Color, radius: androidx.compose.ui.unit.Dp = 18.dp): Modifier = drawBehind {
    val stroke = Stroke(width = 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f)))
    drawRoundRect(color, size = Size(size.width, size.height), cornerRadius = CornerRadius(radius.toPx()), style = stroke)
}

fun colorOf(argb: Int?): Color? = argb?.let { Color(it) }

val BadgeColors = listOf(0xFFC2410C.toInt(), 0xFF3B5BDB.toInt(), 0xFF15803D.toInt(), 0xFF7C3AED.toInt(), 0xFF0F766E.toInt(), 0xFF111827.toInt())
