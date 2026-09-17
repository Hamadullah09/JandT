plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.warehouse.handheld"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.warehouse.handheld"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        // The address of the warehouse PC, compiled in.
        //
        // The laundry build learned this the hard way: a default that only ever
        // existed on one developer's desk means the second handheld somebody
        // sets up installs, opens, and says it cannot reach the server. The
        // Settings screen can override it, but the default has to be the real
        // one.
        buildConfigField("String", "DEFAULT_SERVER", "\"http://192.168.18.40:5080\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // The Chainway SDK, when it is there. compileOnly + a runtime check rather
    // than a hard dependency: the app has to build and install on a machine
    // that has never seen the jar, and has to run on a device that is not a
    // C72. See app/libs/README.md.
    compileOnly(fileTree("libs") { include("*.jar") })
    runtimeOnly(fileTree("libs") { include("*.jar") })
    implementation(fileTree("libs") { include("*.aar") })
}
