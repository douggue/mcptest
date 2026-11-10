import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_21) } }

android {
    namespace = "app.clonespace.probe"
    compileSdk = 36
    defaultConfig {
        applicationId = "app.clonespace.probe"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_21; targetCompatibility = JavaVersion.VERSION_21 }
    sourceSets["main"].java.srcDir("../shared/src/main/kotlin")
}

dependencies {
    implementation(libs.androidx.core.ktx)
}
