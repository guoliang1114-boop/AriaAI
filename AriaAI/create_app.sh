#!/bin/bash

# 创建 .app bundle 结构
APP_NAME="Aria AI"
APP_DIR="$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

# 清理旧的 .app
rm -rf "$APP_DIR"

# 创建目录结构
mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR"

# 复制可执行文件
cp ".build/arm64-apple-macosx/release/$APP_NAME" "$MACOS_DIR/"

# 复制资源 bundle
cp -r ".build/arm64-apple-macosx/release/${APP_NAME}_AriaAI.bundle" "$RESOURCES_DIR/"

# 使用 iconutil 从 AppIcon.appiconset 创建 .icns 文件
# 首先需要创建一个 iconset 目录
ICONSET_DIR="AppIcon.iconset"
rm -rf "$ICONSET_DIR"
mkdir "$ICONSET_DIR"

# 从 Assets.xcassets 复制图标文件到 iconset
cp "AriaAI/Assets.xcassets/AppIcon.appiconset/16.png" "$ICONSET_DIR/icon_16x16.png"
cp "AriaAI/Assets.xcassets/AppIcon.appiconset/32.png" "$ICONSET_DIR/icon_16x16@2x.png"
cp "AriaAI/Assets.xcassets/AppIcon.appiconset/32.png" "$ICONSET_DIR/icon_32x32.png"
cp "AriaAI/Assets.xcassets/AppIcon.appiconset/64.png" "$ICONSET_DIR/icon_32x32@2x.png"
cp "AriaAI/Assets.xcassets/AppIcon.appiconset/128.png" "$ICONSET_DIR/icon_128x128.png"
cp "AriaAI/Assets.xcassets/AppIcon.appiconset/256.png" "$ICONSET_DIR/icon_128x128@2x.png"
cp "AriaAI/Assets.xcassets/AppIcon.appiconset/256.png" "$ICONSET_DIR/icon_256x256.png"
cp "AriaAI/Assets.xcassets/AppIcon.appiconset/512.png" "$ICONSET_DIR/icon_256x256@2x.png"
cp "AriaAI/Assets.xcassets/AppIcon.appiconset/512.png" "$ICONSET_DIR/icon_512x512.png"
cp "AriaAI/Assets.xcassets/AppIcon.appiconset/1024.png" "$ICONSET_DIR/icon_512x512@2x.png"

# 使用 iconutil 创建 .icns 文件
iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/AppIcon.icns"

# 清理临时 iconset 目录
rm -rf "$ICONSET_DIR"

# 创建 Info.plist
cat > "$CONTENTS_DIR/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Aria AI</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.ariaai.app</string>
    <key>CFBundleName</key>
    <string>Aria AI</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
</dict>
</plist>
EOF

# 设置可执行权限
chmod +x "$MACOS_DIR/$APP_NAME"

echo "✅ $APP_DIR 创建成功！"
echo "现在可以运行: open \"$APP_DIR\""
