plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "iq.qusay.device"
    compileSdk = 35

    defaultConfig {
        applicationId = "iq.qusay.device"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // يتنصب بالكيبل بس (مو بالمتجر)، فيكفي مفتاح الحاسبة
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // طابعة جهاز SUNMI (الوصل والليبل)، نفس اللي يستخدمه تطبيق SUNMI القديم
    implementation("com.sunmi:printerx:1.0.17")
}
