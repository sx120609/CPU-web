import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const CpuFlutterApp());
}

final class CpuAppConfig {
  const CpuAppConfig._();

  static const baseUrl = String.fromEnvironment(
    'CPU_WEB_BASE_URL',
    defaultValue: 'https://cpu.lizmt.cn',
  );

  static const appVersionCode = 22;
  static const appVersionName = '3.0.1';
}

final class CpuPalette {
  const CpuPalette._();

  static const teal = Color(0xFF148F7B);
  static const tealDark = Color(0xFF0D6E5E);
  static const gold = Color(0xFFF59E0B);
  static const page = Color(0xFFF8FAFC);
  static const text = Color(0xFF0F172A);
  static const muted = Color(0xFF64748B);
  static const borderSoft = Color(0xFFEEF0F4);
  static const glassBg = Color(0xBFFFFFFF);
  static const tabActiveBg = Color(0x1A148F7B);
}

final class CpuFlutterApp extends StatelessWidget {
  const CpuFlutterApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: '药大拾间',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: CpuPalette.teal,
          primary: CpuPalette.teal,
          secondary: CpuPalette.gold,
          surface: Colors.white,
        ),
        scaffoldBackgroundColor: CpuPalette.page,
      ),
      home: const CpuShell(),
    );
  }
}

final class CpuTab {
  const CpuTab({
    required this.label,
    required this.icon,
    required this.path,
  });

  final String label;
  final IconData icon;
  final String path;
}

const cpuTabs = <CpuTab>[
  CpuTab(
    label: '首页',
    icon: Icons.home_outlined,
    path: '/home',
  ),
  CpuTab(
    label: '教务',
    icon: Icons.menu_book_outlined,
    path: '/jwxt',
  ),
  CpuTab(
    label: '课表',
    icon: Icons.calendar_month_outlined,
    path: '/schedule',
  ),
  CpuTab(
    label: '服务',
    icon: Icons.widgets_outlined,
    path: '/services',
  ),
  CpuTab(
    label: '我的',
    icon: Icons.person_outline,
    path: '/profile',
  ),
];

final class CpuShell extends StatefulWidget {
  const CpuShell({super.key});

  @override
  State<CpuShell> createState() => _CpuShellState();
}

final class _CpuShellState extends State<CpuShell> {
  late final WebViewController _webViewController;
  int _selectedIndex = 0;
  int _progress = 0;
  bool _mainFrameError = false;
  Uri _currentUri = _buildShellUri(cpuTabs.first.path);

  @override
  void initState() {
    super.initState();
    _webViewController = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (progress) {
            if (!mounted) return;
            setState(() => _progress = progress);
          },
          onPageStarted: (url) {
            if (!mounted) return;
            final uri = Uri.tryParse(url);
            setState(() {
              _mainFrameError = false;
              _progress = 0;
              if (uri != null) _syncSelectedTab(uri);
            });
          },
          onPageFinished: (url) {
            if (!mounted) return;
            final uri = Uri.tryParse(url);
            setState(() {
              _progress = 100;
              if (uri != null) _syncSelectedTab(uri);
            });
          },
          onUrlChange: (change) {
            if (!mounted || change.url == null) return;
            final uri = Uri.tryParse(change.url!);
            if (uri == null) return;
            setState(() => _syncSelectedTab(uri));
          },
          onWebResourceError: (error) {
            if (!mounted || error.isForMainFrame != true) return;
            setState(() {
              _mainFrameError = true;
              _progress = 100;
            });
          },
          onNavigationRequest: _handleNavigationRequest,
        ),
      )
      ..loadRequest(_currentUri);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (await _webViewController.canGoBack()) {
          await _webViewController.goBack();
          return;
        }
        await SystemNavigator.pop();
      },
      child: Scaffold(
        body: SafeArea(
          bottom: false,
          child: Stack(
            children: [
              WebViewWidget(controller: _webViewController),
              if (_progress > 0 && _progress < 100)
                Align(
                  alignment: Alignment.topCenter,
                  child: LinearProgressIndicator(
                    value: _progress / 100,
                    minHeight: 2,
                    color: CpuPalette.teal,
                    backgroundColor: CpuPalette.teal.withValues(alpha: 0.08),
                  ),
                ),
              if (_mainFrameError)
                _LoadErrorView(
                  onRetry: () {
                    setState(() => _mainFrameError = false);
                    _webViewController.loadRequest(_currentUri);
                  },
                ),
            ],
          ),
        ),
        bottomNavigationBar: _CpuBottomTabBar(
          selectedIndex: _selectedIndex,
          onTap: _selectTab,
        ),
      ),
    );
  }

  NavigationDecision _handleNavigationRequest(NavigationRequest request) {
    final uri = Uri.tryParse(request.url);
    if (uri == null) return NavigationDecision.prevent;

    if (_shouldOpenExternally(uri)) {
      unawaited(_openExternal(uri));
      return NavigationDecision.prevent;
    }

    final normalized = _normalizeInternalUri(uri);
    if (normalized != uri) {
      _currentUri = normalized;
      unawaited(_webViewController.loadRequest(normalized));
      return NavigationDecision.prevent;
    }

    _currentUri = normalized;
    return NavigationDecision.navigate;
  }

  void _selectTab(int index) {
    final next = _buildShellUri(cpuTabs[index].path);
    setState(() {
      _selectedIndex = index;
      _currentUri = next;
      _mainFrameError = false;
    });
    _webViewController.loadRequest(next);
  }

  void _syncSelectedTab(Uri uri) {
    _currentUri = _normalizeInternalUri(uri);
    final nextIndex = _tabIndexForPath(uri.path);
    if (nextIndex != null) _selectedIndex = nextIndex;
  }

  int? _tabIndexForPath(String path) {
    if (path == '/' || path.startsWith('/home')) return 0;
    if (path.startsWith('/jwxt')) return 1;
    if (path.startsWith('/schedule')) return 2;
    if (path.startsWith('/services')) return 3;
    if (path.startsWith('/profile') ||
        path.startsWith('/messages') ||
        path.startsWith('/admin') ||
        path.startsWith('/u/')) {
      return 4;
    }
    return null;
  }

  static Uri _buildShellUri(String path) {
    final base = Uri.parse(CpuAppConfig.baseUrl);
    final normalizedPath = path.startsWith('/') ? path : '/$path';
    final query = <String, String>{
      ...base.queryParameters,
      'shell': 'flutter',
      'client': _clientQueryValue(),
      'appVersionCode': CpuAppConfig.appVersionCode.toString(),
      'appVersionName': CpuAppConfig.appVersionName,
      'flutterVersionCode': CpuAppConfig.appVersionCode.toString(),
      'flutterVersionName': CpuAppConfig.appVersionName,
    };
    return base.replace(path: normalizedPath, queryParameters: query);
  }

  static String _clientQueryValue() {
    if (defaultTargetPlatform == TargetPlatform.android) return 'android-app';
    if (defaultTargetPlatform == TargetPlatform.iOS) return 'ios-app';
    return 'web';
  }

  Uri _normalizeInternalUri(Uri uri) {
    if (!_isSameAppOrigin(uri)) return uri;
    final nextQuery = <String, String>{
      ...uri.queryParameters,
      'shell': 'flutter',
      'client': _clientQueryValue(),
    };
    if (defaultTargetPlatform == TargetPlatform.android) {
      nextQuery.putIfAbsent(
        'appVersionCode',
        () => CpuAppConfig.appVersionCode.toString(),
      );
      nextQuery.putIfAbsent(
        'appVersionName',
        () => CpuAppConfig.appVersionName,
      );
    }
    return uri.replace(queryParameters: nextQuery);
  }

  bool _shouldOpenExternally(Uri uri) {
    if (uri.scheme != 'http' && uri.scheme != 'https') return true;
    if (!_isSameAppOrigin(uri)) return true;
    final path = uri.path.toLowerCase();
    return path.endsWith('.apk') || path.contains('/downloads/');
  }

  bool _isSameAppOrigin(Uri uri) {
    final base = Uri.parse(CpuAppConfig.baseUrl);
    return uri.scheme == base.scheme &&
        uri.host == base.host &&
        uri.port == base.port;
  }

  Future<void> _openExternal(Uri uri) async {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

final class _CpuBottomTabBar extends StatelessWidget {
  const _CpuBottomTabBar({
    required this.selectedIndex,
    required this.onTap,
  });

  final int selectedIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: CpuPalette.glassBg,
        border: const Border(
          top: BorderSide(color: CpuPalette.borderSoft),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 20,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: ClipRect(
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 16, sigmaY: 16),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
              child: Row(
                children: [
                  for (var i = 0; i < cpuTabs.length; i++)
                    Expanded(
                      child: _CpuBottomTabItem(
                        tab: cpuTabs[i],
                        selected: i == selectedIndex,
                        onTap: () => onTap(i),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

final class _CpuBottomTabItem extends StatelessWidget {
  const _CpuBottomTabItem({
    required this.tab,
    required this.selected,
    required this.onTap,
  });

  final CpuTab tab;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? CpuPalette.teal : CpuPalette.muted;
    return Semantics(
      button: true,
      selected: selected,
      label: tab.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: AnimatedScale(
          scale: selected ? 1.05 : 1,
          duration: const Duration(milliseconds: 200),
          curve: Curves.ease,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            curve: Curves.ease,
            height: 50,
            decoration: BoxDecoration(
              color: selected ? CpuPalette.tabActiveBg : Colors.transparent,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(tab.icon, size: 20, color: color),
                const SizedBox(height: 3),
                Text(
                  tab.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: color,
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    height: 1,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

final class _LoadErrorView extends StatelessWidget {
  const _LoadErrorView({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: CpuPalette.page,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 320),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    color: CpuPalette.teal.withValues(alpha: 0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.wifi_off_rounded,
                    color: CpuPalette.teal,
                    size: 30,
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  '页面暂时无法打开',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: CpuPalette.text,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  '请检查网络连接，或稍后重试。',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: CpuPalette.muted,
                    fontSize: 14,
                    height: 1.6,
                  ),
                ),
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh),
                  label: const Text('重新打开'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
