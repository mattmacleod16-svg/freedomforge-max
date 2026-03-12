#!/usr/bin/env node
/**
 * Generates the Xcode project for FreedomForge Monitor.
 * Run: node mobile/generate-xcodeproj.js
 * Then: open mobile/FreedomForge.xcodeproj
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJ_DIR = path.resolve(__dirname, 'FreedomForge.xcodeproj');

// Deterministic UUID generator
function uuid(seed) {
  return crypto.createHash('md5').update(seed).digest('hex').substring(0, 24).toUpperCase();
}

// All source files
const sourceFiles = [
  { name: 'FreedomForgeApp.swift', dir: '' },
  { name: 'ContentView.swift', dir: '' },
  { name: 'AppState.swift', dir: 'Models' },
  { name: 'DataModels.swift', dir: 'Models' },
  { name: 'APIClient.swift', dir: 'Services' },
  { name: 'NotificationManager.swift', dir: 'Services' },
  { name: 'Components.swift', dir: 'Extensions' },
  { name: 'DashboardView.swift', dir: 'Views/Dashboard' },
  { name: 'PortfolioView.swift', dir: 'Views/Portfolio' },
  { name: 'TradesView.swift', dir: 'Views/Trades' },
  { name: 'RiskView.swift', dir: 'Views/Risk' },
  { name: 'BrainView.swift', dir: 'Views/Brain' },
  { name: 'SignalsView.swift', dir: 'Views/Signals' },
  { name: 'InfrastructureView.swift', dir: 'Views/Infrastructure' },
  { name: 'SettingsView.swift', dir: 'Views/Settings' },
];

// Generate UUIDs
const fileRefs = {};
const buildFileRefs = {};
sourceFiles.forEach((f, i) => {
  const key = f.dir ? `${f.dir}/${f.name}` : f.name;
  fileRefs[key] = uuid(`fileref_${key}`);
  buildFileRefs[key] = uuid(`buildfile_${key}`);
});

const infoPlistRef = uuid('fileref_Info.plist');

// Group UUIDs
const mainGroupId = uuid('mainGroup');
const sourceGroupId = uuid('sourceGroup');
const modelsGroupId = uuid('modelsGroup');
const servicesGroupId = uuid('servicesGroup');
const extensionsGroupId = uuid('extensionsGroup');
const viewsGroupId = uuid('viewsGroup');
const dashboardGroupId = uuid('views_dashboard');
const portfolioGroupId = uuid('views_portfolio');
const tradesGroupId = uuid('views_trades');
const riskGroupId = uuid('views_risk');
const brainGroupId = uuid('views_brain');
const signalsGroupId = uuid('views_signals');
const infraGroupId = uuid('views_infra');
const settingsGroupId = uuid('views_settings');
const frameworksGroupId = uuid('frameworksGroup');

// Target + project
const projectId = uuid('project');
const targetId = uuid('target');
const sourcesBuildPhaseId = uuid('sourcesBuildPhase');
const frameworksBuildPhaseId = uuid('frameworksBuildPhase');
const debugConfigId = uuid('debugConfig');
const releaseConfigId = uuid('releaseConfig');
const targetDebugConfigId = uuid('targetDebugConfig');
const targetReleaseConfigId = uuid('targetReleaseConfig');
const projectConfigListId = uuid('projectConfigList');
const targetConfigListId = uuid('targetConfigList');
const productRefId = uuid('productRef');
const chartsFrameworkId = uuid('chartsFramework');
const chartsBuildFileId = uuid('chartsBuildFile');

function filePath(f) {
  return f.dir ? `FreedomForge/${f.dir}/${f.name}` : `FreedomForge/${f.name}`;
}

function fileRefEntry(f) {
  const key = f.dir ? `${f.dir}/${f.name}` : f.name;
  return `\t\t${fileRefs[key]} /* ${f.name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${f.name}; sourceTree = "<group>"; };`;
}

function buildFileEntry(f) {
  const key = f.dir ? `${f.dir}/${f.name}` : f.name;
  return `\t\t${buildFileRefs[key]} /* ${f.name} in Sources */ = {isa = PBXBuildFile; fileRef = ${fileRefs[key]} /* ${f.name} */; };`;
}

function sourceBuildRef(f) {
  const key = f.dir ? `${f.dir}/${f.name}` : f.name;
  return `\t\t\t\t${buildFileRefs[key]} /* ${f.name} in Sources */,`;
}

// Build the groups
function filesInDir(dir) {
  return sourceFiles.filter(f => f.dir === dir).map(f => {
    const key = f.dir ? `${f.dir}/${f.name}` : f.name;
    return `\t\t\t\t${fileRefs[key]} /* ${f.name} */,`;
  }).join('\n');
}

const pbxproj = `// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {
	};
	objectVersion = 56;
	objects = {

/* Begin PBXBuildFile section */
${sourceFiles.map(buildFileEntry).join('\n')}
		${chartsBuildFileId} /* Charts.framework in Frameworks */ = {isa = PBXBuildFile; fileRef = ${chartsFrameworkId} /* Charts.framework */; };
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
${sourceFiles.map(fileRefEntry).join('\n')}
		${infoPlistRef} /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };
		${productRefId} /* FreedomForge.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = FreedomForge.app; sourceTree = BUILT_PRODUCTS_DIR; };
		${chartsFrameworkId} /* Charts.framework */ = {isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = Charts.framework; path = System/Library/Frameworks/Charts.framework; sourceTree = SDKROOT; };
/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
		${frameworksBuildPhaseId} /* Frameworks */ = {
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
				${chartsBuildFileId} /* Charts.framework in Frameworks */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		${mainGroupId} = {
			isa = PBXGroup;
			children = (
				${sourceGroupId} /* FreedomForge */,
				${frameworksGroupId} /* Frameworks */,
				${productRefId} /* FreedomForge.app */,
			);
			sourceTree = "<group>";
		};
		${sourceGroupId} /* FreedomForge */ = {
			isa = PBXGroup;
			children = (
${filesInDir('')}
				${infoPlistRef} /* Info.plist */,
				${modelsGroupId} /* Models */,
				${servicesGroupId} /* Services */,
				${extensionsGroupId} /* Extensions */,
				${viewsGroupId} /* Views */,
			);
			path = FreedomForge;
			sourceTree = "<group>";
		};
		${modelsGroupId} /* Models */ = {
			isa = PBXGroup;
			children = (
${filesInDir('Models')}
			);
			path = Models;
			sourceTree = "<group>";
		};
		${servicesGroupId} /* Services */ = {
			isa = PBXGroup;
			children = (
${filesInDir('Services')}
			);
			path = Services;
			sourceTree = "<group>";
		};
		${extensionsGroupId} /* Extensions */ = {
			isa = PBXGroup;
			children = (
${filesInDir('Extensions')}
			);
			path = Extensions;
			sourceTree = "<group>";
		};
		${viewsGroupId} /* Views */ = {
			isa = PBXGroup;
			children = (
				${dashboardGroupId} /* Dashboard */,
				${portfolioGroupId} /* Portfolio */,
				${tradesGroupId} /* Trades */,
				${riskGroupId} /* Risk */,
				${brainGroupId} /* Brain */,
				${signalsGroupId} /* Signals */,
				${infraGroupId} /* Infrastructure */,
				${settingsGroupId} /* Settings */,
			);
			path = Views;
			sourceTree = "<group>";
		};
		${dashboardGroupId} /* Dashboard */ = {
			isa = PBXGroup;
			children = (
${filesInDir('Views/Dashboard')}
			);
			path = Dashboard;
			sourceTree = "<group>";
		};
		${portfolioGroupId} /* Portfolio */ = {
			isa = PBXGroup;
			children = (
${filesInDir('Views/Portfolio')}
			);
			path = Portfolio;
			sourceTree = "<group>";
		};
		${tradesGroupId} /* Trades */ = {
			isa = PBXGroup;
			children = (
${filesInDir('Views/Trades')}
			);
			path = Trades;
			sourceTree = "<group>";
		};
		${riskGroupId} /* Risk */ = {
			isa = PBXGroup;
			children = (
${filesInDir('Views/Risk')}
			);
			path = Risk;
			sourceTree = "<group>";
		};
		${brainGroupId} /* Brain */ = {
			isa = PBXGroup;
			children = (
${filesInDir('Views/Brain')}
			);
			path = Brain;
			sourceTree = "<group>";
		};
		${signalsGroupId} /* Signals */ = {
			isa = PBXGroup;
			children = (
${filesInDir('Views/Signals')}
			);
			path = Signals;
			sourceTree = "<group>";
		};
		${infraGroupId} /* Infrastructure */ = {
			isa = PBXGroup;
			children = (
${filesInDir('Views/Infrastructure')}
			);
			path = Infrastructure;
			sourceTree = "<group>";
		};
		${settingsGroupId} /* Settings */ = {
			isa = PBXGroup;
			children = (
${filesInDir('Views/Settings')}
			);
			path = Settings;
			sourceTree = "<group>";
		};
		${frameworksGroupId} /* Frameworks */ = {
			isa = PBXGroup;
			children = (
				${chartsFrameworkId} /* Charts.framework */,
			);
			name = Frameworks;
			sourceTree = "<group>";
		};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		${targetId} /* FreedomForge */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = ${targetConfigListId} /* Build configuration list for PBXNativeTarget "FreedomForge" */;
			buildPhases = (
				${sourcesBuildPhaseId} /* Sources */,
				${frameworksBuildPhaseId} /* Frameworks */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = FreedomForge;
			productName = FreedomForge;
			productReference = ${productRefId} /* FreedomForge.app */;
			productType = "com.apple.product-type.application";
		};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		${projectId} /* Project object */ = {
			isa = PBXProject;
			attributes = {
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 1520;
				LastUpgradeCheck = 1520;
				TargetAttributes = {
					${targetId} = {
						CreatedOnToolsVersion = 15.2;
					};
				};
			};
			buildConfigurationList = ${projectConfigListId} /* Build configuration list for PBXProject "FreedomForge" */;
			compatibilityVersion = "Xcode 14.0";
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (
				en,
				Base,
			);
			mainGroup = ${mainGroupId};
			productRefGroup = ${mainGroupId};
			projectDirPath = "";
			projectRoot = "";
			targets = (
				${targetId} /* FreedomForge */,
			);
		};
/* End PBXProject section */

/* Begin PBXSourcesBuildPhase section */
		${sourcesBuildPhaseId} /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
${sourceFiles.map(sourceBuildRef).join('\n')}
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
		${debugConfigId} /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ANALYZER_NONNULL = YES;
				CLANG_ENABLE_MODULES = YES;
				CLANG_ENABLE_OBJC_ARC = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = dwarf;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				ENABLE_TESTABILITY = YES;
				GCC_DYNAMIC_NO_PIC = NO;
				GCC_OPTIMIZATION_LEVEL = 0;
				GCC_PREPROCESSOR_DEFINITIONS = (
					"DEBUG=1",
					"$(inherited)",
				);
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				MACOSX_DEPLOYMENT_TARGET = 14.0;
				MTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE;
				ONLY_ACTIVE_ARCH = YES;
				SDKROOT = iphoneos;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
				SWIFT_VERSION = 5.0;
				SUPPORTED_PLATFORMS = "iphonesimulator iphoneos macosx";
			};
			name = Debug;
		};
		${releaseConfigId} /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ANALYZER_NONNULL = YES;
				CLANG_ENABLE_MODULES = YES;
				CLANG_ENABLE_OBJC_ARC = YES;
				COPY_PHASE_STRIP = NO;
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				ENABLE_NS_ASSERTIONS = NO;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				GCC_OPTIMIZATION_LEVEL = s;
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				MACOSX_DEPLOYMENT_TARGET = 14.0;
				SDKROOT = iphoneos;
				SWIFT_COMPILATION_MODE = wholemodule;
				SWIFT_OPTIMIZATION_LEVEL = "-O";
				SWIFT_VERSION = 5.0;
				SUPPORTED_PLATFORMS = "iphonesimulator iphoneos macosx";
				VALIDATE_PRODUCT = YES;
			};
			name = Release;
		};
		${targetDebugConfigId} /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = FreedomForge/Info.plist;
				INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
				INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents = YES;
				INFOPLIST_KEY_UILaunchScreen_Generation = YES;
				INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
				INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.freedomforge.monitor;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTS_MACCATALYST = YES;
				SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = YES;
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			};
			name = Debug;
		};
		${targetReleaseConfigId} /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = FreedomForge/Info.plist;
				INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
				INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents = YES;
				INFOPLIST_KEY_UILaunchScreen_Generation = YES;
				INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
				INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.freedomforge.monitor;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTS_MACCATALYST = YES;
				SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = YES;
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			};
			name = Release;
		};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		${projectConfigListId} /* Build configuration list for PBXProject "FreedomForge" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				${debugConfigId} /* Debug */,
				${releaseConfigId} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
		${targetConfigListId} /* Build configuration list for PBXNativeTarget "FreedomForge" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				${targetDebugConfigId} /* Debug */,
				${targetReleaseConfigId} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
/* End XCConfigurationList section */
	};
	rootObject = ${projectId} /* Project object */;
}
`;

// Write the project
fs.mkdirSync(PROJ_DIR, { recursive: true });
fs.writeFileSync(path.join(PROJ_DIR, 'project.pbxproj'), pbxproj);

// Write workspace
const wsDir = path.join(PROJ_DIR, 'project.xcworkspace');
fs.mkdirSync(wsDir, { recursive: true });
fs.writeFileSync(path.join(wsDir, 'contents.xcworkspacedata'), `<?xml version="1.0" encoding="UTF-8"?>
<Workspace
   version = "1.0">
   <FileRef
      location = "self:">
   </FileRef>
</Workspace>
`);

// Write shared data
const sharedDir = path.join(wsDir, 'xcshareddata');
fs.mkdirSync(sharedDir, { recursive: true });
fs.writeFileSync(path.join(sharedDir, 'IDEWorkspaceChecks.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>IDEDidComputeMac32BitWarning</key>
	<true/>
</dict>
</plist>
`);

// Write scheme
const schemesDir = path.join(PROJ_DIR, 'xcshareddata', 'xcschemes');
fs.mkdirSync(schemesDir, { recursive: true });
fs.writeFileSync(path.join(schemesDir, 'FreedomForge.xcscheme'), `<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1520"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "${targetId}"
               BuildableName = "FreedomForge.app"
               BlueprintName = "FreedomForge"
               ReferencedContainer = "container:FreedomForge.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES"
      shouldAutocreateTestPlan = "YES">
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         reuseRunningArtifactsWhenBuildingTests = "YES">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "${targetId}"
            BuildableName = "FreedomForge.app"
            BlueprintName = "FreedomForge"
            ReferencedContainer = "container:FreedomForge.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         reuseRunningArtifactsWhenBuildingTests = "YES">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "${targetId}"
            BuildableName = "FreedomForge.app"
            BlueprintName = "FreedomForge"
            ReferencedContainer = "container:FreedomForge.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
`);

console.log('Xcode project generated at: ' + PROJ_DIR);
console.log('Source files: ' + sourceFiles.length);
console.log('Run: open ' + PROJ_DIR);
