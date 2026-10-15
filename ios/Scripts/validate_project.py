#!/usr/bin/env python3
"""Portable structure/safety checks. This is NOT a Swift compiler or simulator test."""
from pathlib import Path
import json
import re
import struct
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
checks = 0

def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1
    print('PASS:', message)

class OpenStepParser:
    def __init__(self, text):
        text = re.sub(r'/\*.*?\*/|//[^\n]*', '', text, flags=re.S)
        self.tokens = re.findall(r'"(?:\\.|[^"\\])*"|[{}()=;,]|[^\s{}()=;,]+', text)
        self.index = 0
    def pop(self):
        token = self.tokens[self.index]
        self.index += 1
        return token
    def expect(self, expected):
        actual = self.pop()
        assert actual == expected, f'Expected {expected}, got {actual}'
    def value(self):
        token = self.pop()
        if token == '{':
            result = {}
            while self.tokens[self.index] != '}':
                key = self.pop()
                key = json.loads(key) if key.startswith('"') else key
                self.expect('=')
                result[key] = self.value()
                self.expect(';')
            self.expect('}')
            return result
        if token == '(':
            result = []
            while self.tokens[self.index] != ')':
                result.append(self.value())
                if self.tokens[self.index] == ',': self.pop()
            self.expect(')')
            return result
        return json.loads(token) if token.startswith('"') else token

project_path = ROOT/'Aria.xcodeproj/project.pbxproj'
parser = OpenStepParser(project_path.read_text())
project = parser.value()
check(parser.index == len(parser.tokens), 'Xcode project OpenStep structure parses fully')
objects = project['objects']
check(project['rootObject'] in objects, 'Project root object resolves')
for oid, item in objects.items():
    for key in ('fileRef', 'buildConfigurationList', 'mainGroup', 'productRefGroup', 'productReference', 'containerPortal', 'target', 'targetProxy'):
        if key in item: check(item[key] in objects, f'{item["isa"]}.{key} resolves')
    for key in ('children', 'files', 'buildPhases', 'buildConfigurations', 'targets', 'dependencies'):
        for ref in item.get(key, []): check(ref in objects, f'{item["isa"]}.{key} entry resolves')
refs = {x['path'] for x in objects.values() if x['isa']=='PBXFileReference' and x.get('lastKnownFileType')=='sourcecode.swift'}
source_names = {p.name for p in (ROOT/'Aria').glob('*.swift')}
check(source_names | {'AriaTests.swift'} == refs, 'All Swift sources and XCTest file are in the project')
source_builds = [objects[ref]['fileRef'] for x in objects.values() if x['isa']=='PBXSourcesBuildPhase' for ref in x['files']]
check(len(source_builds) == len(source_names)+1, 'Application and test compile phases cover every source exactly once')
check(len(set(source_builds)) == len(source_builds), 'No duplicate source build entries')
targets = [x for x in objects.values() if x['isa']=='PBXNativeTarget']
check({x['name'] for x in targets}=={'Aria','AriaTests'}, 'App and unit-test targets exist')
scheme = ET.parse(ROOT/'Aria.xcodeproj/xcshareddata/xcschemes/Aria.xcscheme')
check(len(scheme.findall('.//TestableReference')) == 1, 'Shared scheme contains unit tests')
for ref in scheme.findall('.//BuildableReference'):
    check(ref.attrib['BlueprintIdentifier'] in objects, 'Shared scheme target resolves')
assets = ROOT/'Aria/Assets.xcassets'
for asset in assets.rglob('Contents.json'):
    json.loads(asset.read_text())
check(len(list(assets.rglob('Contents.json')))==3, 'Asset catalog JSON is valid')
png = (assets/'AppIcon.appiconset/AppIcon.png').read_bytes()
check(png[:8]==b'\x89PNG\r\n\x1a\n', 'App icon is a PNG')
check(struct.unpack('>II',png[16:24])==(1024,1024), 'App icon is 1024 × 1024')
check(png[25] == 2, 'App icon is opaque RGB')
sources = {p.name:p.read_text() for p in (ROOT/'Aria').glob('*.swift')}
joined = '\n'.join(sources.values())
for forbidden in ('URLSession', 'AVAudioSession', 'AVAudioEngine', 'SFSpeechRecognizer', 'import CallKit', 'tel://', 'NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription'):
    check(forbidden not in joined and forbidden not in project_path.read_text(), f'No real service/permission API: {forbidden}')
check('password' not in sources['Models.swift'], 'Password never enters persistent/shared AppStore')
check('aria.onboarding.complete' in sources['Models.swift'], 'Onboarding flag is explicit')
check('.preferredColorScheme(.light)' in sources['AriaApp.swift'], 'App forces light appearance')
app_configs = [x['buildSettings'] for x in objects.values() if x['isa']=='XCBuildConfiguration' and x['buildSettings'].get('PRODUCT_BUNDLE_IDENTIFIER')=='com.example.aria']
check(len(app_configs)==2 and all(x.get('INFOPLIST_KEY_UIUserInterfaceStyle')=='Light' for x in app_configs), 'Both app configurations force light appearance')
for title in ('聊天','动态','灵感','目标','资料库'):
    check(f'Label("{title}"' in sources['AriaApp.swift'], f'Main tab exists: {title}')
for symbol in ('SplashView','OnboardingView','LoginView','ChatView','VoiceModeView','PhoneFlowView','SettingsView','ApprovalDetailView'):
    check(f'struct {symbol}' in joined, f'Required screen exists: {symbol}')
check('value.translation.width < -60' in sources['ChatViews.swift'], 'Left swipe routes to reply')
check('UIPasteboard.general.string = message.text' in sources['ChatViews.swift'], 'Copy action is implemented')
check('chatDraft = context' in sources['Models.swift'], 'Back-to-chat prefills without sending')
check('replyTasks.values.forEach { $0.cancel() }' in sources['Models.swift'], 'Logout cancels pending mock reply')
check('stopTimer()' in sources['VoiceViews.swift'], 'Voice lifecycle cancels its timer')
tests = (ROOT/'AriaTests/AriaTests.swift').read_text()
check(len(re.findall(r'func test\w+',tests)) >= 10, 'At least ten focused XCTest cases included')
# Static regression guards for the second-pass interaction contract. These do not execute Swift.
model = sources['Models.swift']
chat = sources['ChatViews.swift']
content = sources['ContentViews.swift']
voice = sources['VoiceViews.swift']
check('private var drafts: [UUID: ComposerDraft]' in model, 'Composer drafts are keyed by conversation')
check('private(set) var selectedConversationID' in model and 'func selectConversation(id: UUID) -> Bool' in model, 'Conversation selection has a validated model entry point')
check(not re.search(r'store\.selectedConversationID\s*=', joined), 'Views cannot bypass validated conversation selection')
check('func sendDraft() -> Bool' in model and 'guard send(value.text, replyTo: value.replyTo)' in model, 'Composer clears only after an accepted send')
check('drafts.removeAll()' in model, 'Logout clears every in-memory composer')
check('chatDraft += "\\n\\n" + context' in model, 'Context routing preserves existing draft content')
check('searchMessages(matching query: String)' in model and 'let term = query.trimmingCharacters' in model, 'Chat search normalizes its query centrally')
check('self.responseTokens[conversationID] == responseToken' in model, 'Cancelled/restarted replies have identity guards')
check('store.stopResponse()' in chat, 'Current conversation has an accessible stop-response control')
check('ChatBottomPreferenceKey' in chat and 'if isNearBottom || store.messages.last?.role == .user' in chat, 'Automatic scrolling is conditional on reader position or explicit send')
check('.safeAreaInset(edge: .bottom, spacing: 0) { composer }' in chat and 'ToolbarItemGroup(placement: .keyboard)' in chat, 'Composer respects keyboard/safe-area layout and offers dismissal')
check('AccessibleSelectionMenu' in content and 'dynamicTypeSize.isAccessibilitySize' in content, 'Filters/status support large-text menu selection')
check(content.count('.task(id: refreshRequestID)') == 2 and 'try? await Task.sleep' not in content, 'Both content refreshes are view-scoped and cancellation-aware')
check(voice.count('.onChange(of: scenePhase)') == 2 and 'scenePhase == .active' in voice, 'Voice/phone demos explicitly handle app lifecycle')
check(len(re.findall(r'func test\w+', tests)) >= 22, 'Twenty-two focused XCTest cases are included (not executed here)')
# Static persistence contract guards. Actual file roundtrips/faults are covered by authored XCTest, not Python.
persistence = sources['Persistence.swift']
app = sources['AriaApp.swift']
settings = sources['SettingsViews.swift']
snapshot_definition = persistence.split('enum DemoStorageError')[0]
check('struct DemoSnapshot: Codable' in persistence and 'currentVersion = 2' in persistence, 'Local demo document has an explicit Codable version')
check(not re.search(r'var (password|email|profileEmail|token|stage|sessionID)\b', snapshot_definition), 'Snapshot schema excludes login, email, credentials and session identity')
check('let id: UUID' in model and 'let date: Date' in model and 'init(id: UUID = UUID()' in model, 'Message identity and timestamps decode as stored values')
check('protocol DemoPersistence' in persistence and 'persistence: DemoPersistence? = nil' in model, 'Persistence is injectable and disabled by default in unit-test stores')
check('AppStore(persistence: FileDemoPersistence())' in app, 'App explicitly enables sandboxed local storage')
check('URL.applicationSupportDirectory' in persistence and 'isExcludedFromBackup = true' in persistence, 'Snapshots use Application Support excluded from device backup')
check('options: [.atomic, .completeFileProtection]' in persistence, 'Snapshot replacement requests atomic writing and complete file protection')
check('fileExists' not in persistence and 'CocoaError.Code.fileReadNoSuchFile' in persistence and 'CocoaError.Code.fileNoSuchFile' in persistence, 'Storage distinguishes explicit absence from inaccessible files')
check(persistence.index('size.intValue <= Self.maximumBytes') < persistence.index('Data(contentsOf: fileURL)'), 'Storage checks file size before decoding')
check('unsupportedVersion(header.schemaVersion)' in persistence and 'case .blocked' in model, 'Unknown schemas block writes rather than being replaced')
check('LegacyDemoSnapshotV1' in persistence and 'migrationNeedsArchive' in model, 'Draft-less compatibility migration is explicit and archived before replacement')
check('Set(messages.map(\\.id)).count == messages.count' in persistence and 'approvalIDs.contains' in persistence and 'conversationIDs.contains($0.conversationID)' in persistence, 'Restore validates stable IDs and message/draft foreign keys')
check('guard let persistence, !restoreBlocked, hasUnsavedChanges' in model, 'Automatic flush cannot overwrite blocked originals')
check('guard !hasUnsavedChanges else' in model and 'applyLoad(persistence.load())' in model, 'Retry cannot overwrite newer temporary edits by restoring an old file')
check('300_000_000' in model and 'if phase != .active { store.flushPersistence() }' in app, 'Debounced changes also flush on app lifecycle transitions')
logout = model.split('func logout()')[1].split('func replayOnboarding()')[0]
check('drafts.removeAll()' in logout and 'flushPersistence()' in logout and 'seedDemo()' not in logout, 'Logout flushes draft removal while preserving history and no login state')
reset = model.split('func resetLocalDemo()')[1].split('private func makeSnapshot()')[0]
check(reset.index('archiveCurrent()') < reset.index('persistence.save(fresh)') < reset.index('applySnapshot(fresh)'), 'Confirmed reset archives and writes successfully before changing memory')
check('copyItem(at: fileURL' in persistence and 'removeItem' not in persistence, 'Recovery archives are copied and never silently deleted')
check('pendingReplyConversationIDs' in persistence and '不会自动继续' in model, 'Interrupted reply markers restore without launching old tasks')
check('clean.utf8.count <= 100_000' in model and 'conversations.count < 200' in model, 'Oversized sends and excess conversations are rejected before permanent history changes')
check('persistenceState.needsAttention' in app and 'DataControlView()' in app, 'Save failures have a main-screen action to data controls')
check('未保存' in settings and '旧快照' in settings and '所有模拟邮箱' in settings, 'Reset and privacy UI disclose unsaved loss and shared local mock data')
check(len(re.findall(r'func test\w+', tests)) >= 51, 'Fifty-one authored XCTest cases include persistence failure/restart coverage (not executed here)')
check(not any(p.name in {'aria.html','.env','credentials.json'} for p in ROOT.rglob('*')), 'No original prototype or credential file in deliverable')
print(f'\n{checks} portable checks passed.')
print('NOT RUN: Swift compilation, XCTest execution, iOS simulator, device/UI/VoiceOver testing.')
