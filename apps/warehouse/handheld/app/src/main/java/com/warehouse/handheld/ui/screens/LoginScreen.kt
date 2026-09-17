package com.warehouse.handheld.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.warehouse.handheld.HandheldApp
import com.warehouse.handheld.data.str
import com.warehouse.handheld.data.ApiError
import com.warehouse.handheld.data.ServerFinder
import com.warehouse.handheld.ui.ScanResult
import com.warehouse.handheld.ui.Tone
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun LoginScreen(app: HandheldApp, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()

    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var server by remember { mutableStateOf(app.session.serverUrl) }
    var showServer by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var searching by remember { mutableStateOf(false) }

    fun signIn() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                app.session.serverUrl = server
                val body = JSONObject().put("username", username.trim()).put("password", password)
                val reply = app.api.post("/api/auth/login", body)

                app.session.token = reply.str("token")
                reply.optJSONObject("user")?.let {
                    app.session.userName = it.str("full_name").ifEmpty { it.str("username") }
                    app.session.role = it.optString("role", "operator")
                }
                onDone()
            } catch (e: ApiError) {
                error = e.message
                // A wrong address and a wrong password both come back as a
                // failure to sign in, and they are fixed in different places -
                // so when it could be the address, show the address.
                if (e.isOffline) showServer = true
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Clothing Warehouse", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Sign in to book stock in, pick and take returns.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(24.dp))

        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("Username") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        )

        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
        )

        if (showServer) {
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = server,
                onValueChange = { server = it },
                label = { Text("Server address") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            // Here as well as in Settings, because Settings is behind signing
            // in and a wrong address is exactly what stops somebody signing in.
            // Offering the fix only on the far side of the door it locks is no
            // fix at all.
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = {
                    searching = true
                    error = null
                    scope.launch {
                        val found = ServerFinder.find()
                        searching = false
                        if (found != null) {
                            app.session.serverUrl = found
                            server = app.session.serverUrl
                            error = null
                        } else {
                            error = "Nothing answered on this network. Check the PC is on, " +
                                "that START.cmd has been run, and that this scanner is on the " +
                                "same Wi-Fi."
                        }
                    }
                },
                enabled = !searching,
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) { Text(if (searching) "Looking…" else "Find the warehouse PC") }
        }

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = ::signIn,
            enabled = !busy && username.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) {
            Text(if (busy) "Signing in…" else "Sign in")
        }

        Spacer(Modifier.height(8.dp))

        TextButton(onClick = { showServer = !showServer }) {
            Text(if (showServer) "Hide the server address" else app.session.serverUrl)
        }

        Spacer(Modifier.height(12.dp))
        ScanResult(error, Tone.Bad)
    }
}
