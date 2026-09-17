package com.warehouse.handheld.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.sp

/**
 * Light, and larger than a phone app.
 *
 * A warehouse is lit from above and a handheld is read at arm's length by
 * somebody holding a garment in the other hand. The type here is a step up from
 * Material's defaults for that reason, not for style.
 *
 * The palette is the office website's, so somebody who moves between the two
 * all day is not learning two sets of colours: the same blue means the same
 * thing, and green, red and amber mean worked, refused, careful on both.
 */

val Paper = Color(0xFFF4F6FA)
val Card = Color(0xFFFFFFFF)
val Ink = Color(0xFF16181D)
val InkSoft = Color(0xFF525A6B)

/* Strong enough to carry white text when they fill a button, dark enough to
   read as text on their own pale tint. One colour has to do both jobs. */
val Good = Color(0xFF15803D)
val GoodDim = Color(0xFFDCFCE7)
val Bad = Color(0xFFB91C1C)
val BadDim = Color(0xFFFEE2E2)
val Warn = Color(0xFFB45309)
val WarnDim = Color(0xFFFEF3C7)
val Cool = Color(0xFF1D4ED8)

private val LightColors = lightColorScheme(
    primary = Cool,
    // White, not near-black. The three coloured buttons on the find screen set
    // only their fill and take their text colour from here, so this is what
    // decides whether "Got it" reads white on green or black on green.
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDBE6FF),
    onPrimaryContainer = Color(0xFF10307F),

    // Secondary and tertiary, spelled out even though nothing here asks for
    // them by name.
    //
    // lightColorScheme() fills in whatever is left out, and what it fills in is
    // Material's own baseline - which is lilac. It showed up as the selected
    // "Resellable" chip on the returns screen: one lilac control in an app
    // where every other accent is blue, and nothing in this file to explain it.
    // A component reaching for a role nobody set should still land on our
    // palette.
    secondary = Cool,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFDBE6FF),
    onSecondaryContainer = Color(0xFF10307F),
    tertiary = Cool,
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFDBE6FF),
    onTertiaryContainer = Color(0xFF10307F),

    errorContainer = BadDim,
    onErrorContainer = Bad,

    background = Paper,
    onBackground = Ink,
    surface = Card,
    onSurface = Ink,
    surfaceVariant = Color(0xFFE8ECF4),
    onSurfaceVariant = InkSoft,
    error = Bad,
    onError = Color.White,
    outline = Color(0xFFC3CAD8),
)

private val BigType = Typography(
    headlineMedium = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.Bold),
    titleLarge = TextStyle(fontSize = 21.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 17.sp),
    bodyMedium = TextStyle(fontSize = 15.sp),
    labelLarge = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium),
)

/**
 * How big everything is drawn, against Android's normal size.
 *
 * The owner found the full size too big - a list of finds showed three rows -
 * and asked for smaller text and controls so more fits on the screen. The
 * density is scaled rather than every size retuned by hand, so text, buttons,
 * spacing and the radar all shrink together and keep their proportions.
 * Settings can set it back up for somebody who needs it larger.
 */
enum class UiSize(val scale: Float, val label: String) {
    Small(0.8f, "Small"),
    Medium(0.9f, "Medium"),
    Large(1.0f, "Large"),
    ;

    companion object {
        fun named(name: String?): UiSize = entries.firstOrNull { it.name == name } ?: Small
    }
}

/**
 * Always light, whatever the device is set to.
 *
 * Fixed rather than following the system, for the same reason it was fixed
 * before: a screen that changes colour on its own at six o'clock, because
 * somebody left the automatic switch on, is a screen two operators describe
 * differently down a phone.
 */
@Composable
fun HandheldTheme(size: UiSize = UiSize.Small, content: @Composable () -> Unit) {
    val device = LocalDensity.current
    CompositionLocalProvider(
        LocalDensity provides Density(device.density * size.scale, device.fontScale),
    ) {
        MaterialTheme(
            colorScheme = LightColors,
            typography = BigType,
            content = content,
        )
    }
}
