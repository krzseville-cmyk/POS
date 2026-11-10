plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The POS itself is the web app in the repository root. It is copied into the
// app's assets on every build, so the browser and Android versions never drift apart.
val webAssetsDir = layout.buildDirectory.dir("generated/webAssets")
val copyWebAssets by tasks.registering(Copy::class) {
    from(rootProject.file("../index.html"), rootProject.file("../styles.css"), rootProject.file("../app.js"))
    into(webAssetsDir)
}

android {
    namespace = "com.simplepos.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.simplepos.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "2.2.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    sourceSets["main"].assets.srcDir(webAssetsDir)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

tasks.named("preBuild") { dependsOn(copyWebAssets) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    // The scanner pulls in an old Fragment library; the result APIs above need 1.3.0+.
    implementation("androidx.fragment:fragment-ktx:1.8.5")
}
