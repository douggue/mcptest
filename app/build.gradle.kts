import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_21) } }

android {
    namespace = "app.clonespace"
    compileSdk = 36
    ndkVersion = "29.0.13846066"

    defaultConfig {
        applicationId = "app.clonespace"
        minSdk = 24
        targetSdk = 36          // Google Play requires 36 for new apps and updates since 2026-08-31
        versionCode = 1
        versionName = "0.1.0"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
        // Shown in the diagnostic report, so a report says which build produced it.
        buildConfigField("String", "GIT_SHA", "\"${(System.getenv("GITHUB_SHA") ?: "local").take(7)}\"")
    }

    // play: no VpnService, no MANAGE_EXTERNAL_STORAGE. sideload: both, for users who want the extras.
    flavorDimensions += "dist"
    productFlavors {
        create("play") { dimension = "dist" }
        create("sideload") { dimension = "dist" }
    }

    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_21; targetCompatibility = JavaVersion.VERSION_21 }

    packaging { jniLibs { useLegacyPackaging = true } }   // the engine loads libblackbox from extracted files

    sourceSets["main"].java.srcDir("../shared/src/main/kotlin")
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/probeAssets"))

    buildTypes {
        debug {
            // Clones run inside this app's processes and inherit its flags. In a debuggable process
            // Android ignores an app's precompiled code and runs it in a slower mode, so every clone
            // paid for it. The key and everything else stay as in a debug build.
            isDebuggable = false
        }
        release {
            isMinifyEnabled = false   // the engine's keep rules cover most classes; enable after device testing
        }
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    // The engine is fetched by scripts/fetch-engine.sh. Without it the app cannot compile.
    if (rootProject.findProject(":Bcore") != null) implementation(project(":Bcore"))

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(kotlin("test"))
    testImplementation("org.json:json:20240303")
}

// Build the probe app and ship it as an asset; the leak test installs it inside a clone.
val copyProbeApk by tasks.registering(Copy::class) {
    dependsOn(":probe:assembleDebug")
    from(project(":probe").layout.buildDirectory.file("outputs/apk/debug/probe-debug.apk"))
    rename { "probe.apk" }
    into(layout.buildDirectory.dir("generated/probeAssets"))
}
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach { dependsOn(copyProbeApk) }
