pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Where the Chainway SDK goes. It is not on any Maven repository, so
        // the jar is dropped into app/libs by hand - see app/libs/README.md.
        flatDir { dirs("app/libs") }
    }
}

rootProject.name = "WarehouseHandheld"
include(":app")
