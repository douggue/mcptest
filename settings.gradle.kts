pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // No JitPack: the engine's only JitPack dependency (FreeReflection) is replaced by patch 0003.
    }
}

rootProject.name = "CloneSpace"

include(":app", ":probe")

// The engine is fetched by scripts/fetch-engine.sh (git-ignored). Without it the app cannot build.
val engineDir = file("engine")
if (File(engineDir, "Bcore/build.gradle").exists()) {
    include(":Bcore", ":black-reflection", ":compiler")
    project(":Bcore").projectDir = File(engineDir, "Bcore")
    project(":black-reflection").projectDir = File(engineDir, "black-reflection")
    project(":compiler").projectDir = File(engineDir, "compiler")
} else {
    logger.warn("engine/ not found. Run scripts/fetch-engine.sh first; :app will not compile without it.")
}
