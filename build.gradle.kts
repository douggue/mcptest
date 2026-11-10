plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}

// Values read by the engine's own Groovy build files (rootProject.ext.*). Keep in sync with
// patches/0009-raise-sdk-levels.patch.
extra["compileSdkVersion"] = 36
extra["targetSdkVersion"] = 36
extra["minSdk"] = 24
extra["ndkVersion"] = "29.0.13846066"
extra["hiddenApiBypass"] = "4.3"
