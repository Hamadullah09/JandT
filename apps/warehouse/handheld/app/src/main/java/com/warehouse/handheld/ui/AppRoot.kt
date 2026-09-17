package com.warehouse.handheld.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.warehouse.handheld.HandheldApp
import com.warehouse.handheld.ui.screens.FindScreen
import com.warehouse.handheld.ui.screens.HomeScreen
import com.warehouse.handheld.ui.screens.IntakeDetailScreen
import com.warehouse.handheld.ui.screens.IntakeListScreen
import com.warehouse.handheld.ui.screens.LoginScreen
import com.warehouse.handheld.ui.screens.MoveScreen
import com.warehouse.handheld.ui.screens.OrderDetailScreen
import com.warehouse.handheld.ui.screens.OrderListScreen
import com.warehouse.handheld.ui.screens.ProductSearchScreen
import com.warehouse.handheld.ui.screens.ReturnRoomScreen
import com.warehouse.handheld.ui.screens.SettingsScreen

/** Where the app can be. A list, not a router: there are ten of them. */
sealed interface Screen {
    data object Login : Screen
    data object Home : Screen
    data object Settings : Screen

    data object Intakes : Screen
    data class Intake(val id: Int, val label: String) : Screen

    data object Orders : Screen
    data class Order(val id: Int, val label: String) : Screen

    /** The returns room: sweep, grade, add. There is no per-return screen any more. */
    data object Returns : Screen

    data object Products : Screen

    data object Find : Screen
    /** A hunt for any one garment of a colour and size, opened from the product search. */
    data class FindGroup(val group: String, val label: String) : Screen
    data object Move : Screen
}

/**
 * The screen BACK should go to, or null when there is nowhere above.
 *
 * Written out rather than kept as a stack because the nesting here is one level
 * deep and fixed: a detail screen belongs to its list, a list belongs to Home.
 * A stack would also have to be pruned - signing out with four screens behind
 * you must not let BACK walk back into them.
 */
private fun parentOf(screen: Screen): Screen? = when (screen) {
    Screen.Login, Screen.Home -> null
    Screen.Settings, Screen.Find, Screen.Move -> Screen.Home
    Screen.Intakes, Screen.Orders, Screen.Returns, Screen.Products -> Screen.Home
    is Screen.Intake -> Screen.Intakes
    is Screen.Order -> Screen.Orders
    // Back from a hunt goes to the search it came from, so the next colour or
    // size is one tap away.
    is Screen.FindGroup -> Screen.Products
}

@Composable
fun AppRoot(app: HandheldApp, screen: Screen, onNavigate: (Screen) -> Unit) {
    // The hardware BACK key goes up a screen, the way the arrow in the corner
    // does.
    //
    // Without this it did what BACK does to any single-activity app that has
    // not said otherwise: it closed the whole thing. An operator three screens
    // into an intake who presses the key next to their thumb should not be
    // looking at the launcher, and on a handheld that key is pressed by
    // accident constantly.
    //
    // On Home and on the sign-in screen there is nowhere above to go, so BACK
    // is left alone and still leaves the app, which is what it should do there.
    val up = parentOf(screen)
    BackHandler(enabled = up != null) { up?.let(onNavigate) }

    // Surface rather than a Box painted with the background colour.
    //
    // A Box only draws; a Surface also says what colour the text on it should
    // be. Without one, every Text that does not name its own colour falls back
    // to Compose's default of black, and on a dark theme that is a heading
    // nobody can read - which is exactly how the sign-in title came out on the
    // first install.
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onBackground,
    ) {
        Column(Modifier.fillMaxSize()) {
            when (screen) {
                Screen.Login -> LoginScreen(app, onDone = { onNavigate(Screen.Home) })
                Screen.Home -> HomeScreen(app, onNavigate)
                Screen.Settings -> SettingsScreen(app, onBack = { onNavigate(Screen.Home) })

                Screen.Intakes -> IntakeListScreen(app, onNavigate)
                is Screen.Intake -> IntakeDetailScreen(app, screen, onBack = { onNavigate(Screen.Intakes) })

                Screen.Orders -> OrderListScreen(app, onNavigate)
                is Screen.Order -> OrderDetailScreen(app, screen, onBack = { onNavigate(Screen.Orders) })

                Screen.Returns -> ReturnRoomScreen(app, onBack = { onNavigate(Screen.Home) })

                Screen.Products -> ProductSearchScreen(app, onNavigate)

                Screen.Find -> FindScreen(app, onBack = { onNavigate(Screen.Home) })
                is Screen.FindGroup -> FindScreen(
                    app,
                    group = screen.group,
                    groupLabel = screen.label,
                    onBack = { onNavigate(Screen.Products) },
                )
                Screen.Move -> MoveScreen(app, onBack = { onNavigate(Screen.Home) })
            }
        }
    }
}
