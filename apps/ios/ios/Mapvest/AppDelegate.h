// Prebuilt ReactNativeDependencies omits folly/coro headers. Xcode 26's
// clang enables __cpp_impl_coroutine, so Folly would otherwise set
// FOLLY_HAS_COROUTINES=1 and fail compiling this file (EAS build 24).
#ifndef FOLLY_CFG_NO_COROUTINES
#define FOLLY_CFG_NO_COROUTINES 1
#endif
#ifndef FOLLY_HAS_COROUTINES
#define FOLLY_HAS_COROUTINES 0
#endif

#import <RCTAppDelegate.h>
#import <UIKit/UIKit.h>
#import <Expo/Expo.h>

@interface AppDelegate : EXAppDelegateWrapper

@end
