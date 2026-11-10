package app.clonespace.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** Colour tokens from plan.md section 5.2, with dark values at the same hue and 4.5:1 contrast. */
@Immutable
data class Tokens(
    val badge: Color,
    val warning: Color,
    val warningSoft: Color,
    val success: Color,
    val accentSoft: Color,
)

private val LightTokens = Tokens(
    badge = Color(0xFFC2410C), warning = Color(0xFFC2410C), warningSoft = Color(0xFFFFF4EC),
    success = Color(0xFF15803D), accentSoft = Color(0xFFEEF1FD),
)
private val DarkTokens = Tokens(
    badge = Color(0xFFFF9A66), warning = Color(0xFFFF9A66), warningSoft = Color(0xFF3A2518),
    success = Color(0xFF4ADE80), accentSoft = Color(0xFF242B52),
)

val LocalTokens = staticCompositionLocalOf { LightTokens }

private val Light = lightColorScheme(
    primary = Color(0xFF3B5BDB), onPrimary = Color.White,
    primaryContainer = Color(0xFFEEF1FD), onPrimaryContainer = Color(0xFF2B44A8),
    background = Color(0xFFF7F7FA), onBackground = Color(0xFF16161D),
    surface = Color.White, onSurface = Color(0xFF16161D),
    surfaceVariant = Color(0xFFF1F1F6), onSurfaceVariant = Color(0xFF5B5B6B),
    outline = Color(0xFFE2E2EA), outlineVariant = Color(0xFFE8E8EF),
    error = Color(0xFFC2410C), onError = Color.White,
)
private val Dark = darkColorScheme(
    primary = Color(0xFF8FA5FF), onPrimary = Color(0xFF0F1633),
    primaryContainer = Color(0xFF242B52), onPrimaryContainer = Color(0xFFD6DDFF),
    background = Color(0xFF111118), onBackground = Color(0xFFEDEDF4),
    surface = Color(0xFF1B1B24), onSurface = Color(0xFFEDEDF4),
    surfaceVariant = Color(0xFF242430), onSurfaceVariant = Color(0xFFA9A9BA),
    outline = Color(0xFF3A3A48), outlineVariant = Color(0xFF2C2C38),
    error = Color(0xFFFF9A66), onError = Color(0xFF1B1B24),
)

@Composable
fun CloneSpaceTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalTokens provides if (dark) DarkTokens else LightTokens) {
        MaterialTheme(
            colorScheme = if (dark) Dark else Light,
            typography = AppTypography,
            content = content,
        )
    }
}

val MaterialTheme.tokens: Tokens
    @Composable get() = LocalTokens.current
