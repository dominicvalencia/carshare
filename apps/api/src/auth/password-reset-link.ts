export function passwordResetAppScheme(
  environment: 'local' | 'test' | 'staging' | 'production',
): string {
  return {
    local: 'carrental',
    test: 'carshare-test',
    staging: 'carshare-staging',
    production: 'carshare',
  }[environment];
}
