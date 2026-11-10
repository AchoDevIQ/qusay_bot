plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.qmath.label"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.qmath.label"
        minSdk = 24
        targetSdk = 34
        versionCode = 3
        versionName = "1.2"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // مكتبة طابعة SUNMI الداخلية: فيها labelLocate وlabelOutput حتى الليبل ينطبع بمكانه
    implementation("com.sunmi:printerlibrary:1.0.24")
}
