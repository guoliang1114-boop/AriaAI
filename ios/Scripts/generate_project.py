#!/usr/bin/env python3
"""Generate a dependency-free, deterministic Xcode project (no XcodeGen needed)."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]

def uid(value):
    return hashlib.sha1(value.encode()).hexdigest()[:24].upper()

def quoted(value):
    return json.dumps(str(value), ensure_ascii=False)

objects = []
def obj(key, body):
    objects.append(f'\t\t{uid(key)} = {{\n{body}\n\t\t}};')
def refs(keys):
    return '(\n' + ''.join(f'\t\t\t\t{uid(k)},\n' for k in keys) + '\t\t\t)'
def settings(values):
    return '\n'.join(f'\t\t\t\t{k} = {quoted(v)};' for k, v in values.items())

sources = sorted(p.name for p in (ROOT/'Aria').glob('*.swift'))
for name in sources:
    obj('file:'+name, f'\t\t\tisa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {quoted(name)}; sourceTree = "<group>";')
    obj('build:'+name, f'\t\t\tisa = PBXBuildFile; fileRef = {uid("file:"+name)};')
obj('assets', '\t\t\tisa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>";')
obj('assetsBuild', f'\t\t\tisa = PBXBuildFile; fileRef = {uid("assets")};')
test_sources = sorted(p.name for p in (ROOT/'AriaTests').glob('*.swift'))
for name in test_sources:
    obj('testfile:'+name, f'\t\t\tisa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {quoted(name)}; sourceTree = "<group>";')
    obj('testbuild:'+name, f'\t\t\tisa = PBXBuildFile; fileRef = {uid("testfile:"+name)};')
for key, path, typ in [('appProduct','Aria.app','wrapper.application'), ('testProduct','AriaTests.xctest','wrapper.cfbundle')]:
    obj(key, f'\t\t\tisa = PBXFileReference; explicitFileType = {typ}; includeInIndex = 0; path = {path}; sourceTree = BUILT_PRODUCTS_DIR;')
obj('appGroup', f'\t\t\tisa = PBXGroup; children = {refs(["file:"+n for n in sources]+["assets"])}; path = Aria; sourceTree = "<group>";')
obj('testGroup', f'\t\t\tisa = PBXGroup; children = {refs(["testfile:"+n for n in test_sources])}; path = AriaTests; sourceTree = "<group>";')
obj('productsGroup', f'\t\t\tisa = PBXGroup; children = {refs(["appProduct","testProduct"])}; name = Products; sourceTree = "<group>";')
obj('mainGroup', f'\t\t\tisa = PBXGroup; children = {refs(["appGroup","testGroup","productsGroup"])}; sourceTree = "<group>";')
for key, isa, files in [('appSources','PBXSourcesBuildPhase',["build:"+n for n in sources]), ('appResources','PBXResourcesBuildPhase',['assetsBuild']), ('appFrameworks','PBXFrameworksBuildPhase',[]), ('testSources','PBXSourcesBuildPhase',["testbuild:"+n for n in test_sources]), ('testResources','PBXResourcesBuildPhase',[]), ('testFrameworks','PBXFrameworksBuildPhase',[])]:
    obj(key, f'\t\t\tisa = {isa}; buildActionMask = 2147483647; files = {refs(files)}; runOnlyForDeploymentPostprocessing = 0;')
obj('proxy', f'\t\t\tisa = PBXContainerItemProxy; containerPortal = {uid("project")}; proxyType = 1; remoteGlobalIDString = {uid("appTarget")}; remoteInfo = Aria;')
obj('dependency', f'\t\t\tisa = PBXTargetDependency; target = {uid("appTarget")}; targetProxy = {uid("proxy")};')
for prefix, name, product, kind, deps in [('app','Aria','appProduct','com.apple.product-type.application',[]), ('test','AriaTests','testProduct','com.apple.product-type.bundle.unit-test',['dependency'])]:
    obj(prefix+'Target', f'\t\t\tisa = PBXNativeTarget; buildConfigurationList = {uid(prefix+"ConfigList")}; buildPhases = {refs([prefix+"Sources",prefix+"Frameworks",prefix+"Resources"])}; buildRules = (); dependencies = {refs(deps)}; name = {name}; productName = {name}; productReference = {uid(product)}; productType = {quoted(kind)};')
common = {'CLANG_ENABLE_MODULES':'YES','CLANG_ENABLE_OBJC_ARC':'YES','SDKROOT':'iphoneos','IPHONEOS_DEPLOYMENT_TARGET':'17.0','SWIFT_VERSION':'5.0','ENABLE_USER_SCRIPT_SANDBOXING':'YES','CLANG_WARN_DOCUMENTATION_COMMENTS':'YES','GCC_WARN_UNUSED_VARIABLE':'YES','GCC_WARN_UNUSED_FUNCTION':'YES'}
app = {'PRODUCT_BUNDLE_IDENTIFIER':'com.example.aria','PRODUCT_NAME':'$(TARGET_NAME)','CODE_SIGN_STYLE':'Automatic','GENERATE_INFOPLIST_FILE':'YES','INFOPLIST_KEY_CFBundleDisplayName':'Aria','INFOPLIST_KEY_UIUserInterfaceStyle':'Light','INFOPLIST_KEY_NSMicrophoneUsageDescription':'仅在你开始云端语音时采集语音，发送到你登录的 Aria 服务器进行识别；不保存原始录音。','INFOPLIST_KEY_UILaunchScreen_Generation':'YES','INFOPLIST_KEY_LSApplicationCategoryType':'public.app-category.productivity','INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone':'UIInterfaceOrientationPortrait','INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad':'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight','INFOPLIST_KEY_UIApplicationSceneManifest_Generation':'YES','TARGETED_DEVICE_FAMILY':'1,2','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME':'AccentColor','MARKETING_VERSION':'1.0','CURRENT_PROJECT_VERSION':'1','SWIFT_EMIT_LOC_STRINGS':'YES','LD_RUNPATH_SEARCH_PATHS':'$(inherited) @executable_path/Frameworks','ENABLE_PREVIEWS':'YES'}
test = {'PRODUCT_BUNDLE_IDENTIFIER':'com.example.aria.tests','PRODUCT_NAME':'$(TARGET_NAME)','CODE_SIGN_STYLE':'Automatic','GENERATE_INFOPLIST_FILE':'YES','TARGETED_DEVICE_FAMILY':'1,2','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','BUNDLE_LOADER':'$(TEST_HOST)','TEST_HOST':'$(BUILT_PRODUCTS_DIR)/Aria.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Aria','LD_RUNPATH_SEARCH_PATHS':'$(inherited) @executable_path/Frameworks @loader_path/Frameworks'}
for prefix, config in [('project', common), ('app', app), ('test', test)]:
    for mode in ['Debug','Release']:
        values = dict(config)
        if prefix == 'project':
            values.update({'SWIFT_OPTIMIZATION_LEVEL':'-Onone' if mode=='Debug' else '-O','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG' if mode=='Debug' else '', 'DEBUG_INFORMATION_FORMAT':'dwarf' if mode=='Debug' else 'dwarf-with-dsym','ENABLE_TESTABILITY':'YES' if mode=='Debug' else 'NO','ONLY_ACTIVE_ARCH':'YES' if mode=='Debug' else 'NO'})
        obj(prefix+mode, f'\t\t\tisa = XCBuildConfiguration; buildSettings = {{\n{settings(values)}\n\t\t\t}}; name = {mode};')
    obj(prefix+'ConfigList', f'\t\t\tisa = XCConfigurationList; buildConfigurations = {refs([prefix+"Debug",prefix+"Release"])}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
obj('project', f'\t\t\tisa = PBXProject; attributes = {{ BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 1600; TargetAttributes = {{ {uid("appTarget")} = {{ CreatedOnToolsVersion = 16.0; }}; {uid("testTarget")} = {{ CreatedOnToolsVersion = 16.0; TestTargetID = {uid("appTarget")}; }}; }}; }}; buildConfigurationList = {uid("projectConfigList")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = "zh-Hans"; hasScannedForEncodings = 0; knownRegions = ("zh-Hans", en, Base); mainGroup = {uid("mainGroup")}; productRefGroup = {uid("productsGroup")}; projectDirPath = ""; projectRoot = ""; targets = {refs(["appTarget","testTarget"])};')
project = ROOT/'Aria.xcodeproj'
project.mkdir(exist_ok=True)
(project/'project.pbxproj').write_text('// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 56;\n\tobjects = {\n'+'\n'.join(objects)+f'\n\t}};\n\trootObject = {uid("project")};\n}}\n')
def reference(target, name):
    return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid(target)}" BuildableName="{name}" BlueprintName="{name.split(".")[0]}" ReferencedContainer="container:Aria.xcodeproj"/>'
appref = reference('appTarget','Aria.app')
testref = reference('testTarget','AriaTests.xctest')
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.7">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
    <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{appref}</BuildActionEntry>
  </BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{testref}</TestableReference></Testables></TestAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{appref}</BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{appref}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
'''
schemepath=project/'xcshareddata/xcschemes/Aria.xcscheme'
schemepath.parent.mkdir(parents=True,exist_ok=True)
schemepath.write_text(scheme)
print(f'Generated Xcode project with {len(sources)} application Swift files and {len(test_sources)} XCTest files.')
