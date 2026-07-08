import 'package:flutter_test/flutter_test.dart';

import 'package:cpu_flutter_client/main.dart';

void main() {
  test('bottom navigation keeps the first-stage shell routes', () {
    expect(cpuTabs.map((tab) => tab.path), [
      '/home',
      '/jwxt',
      '/schedule',
      '/services',
      '/profile',
    ]);
  });
}
