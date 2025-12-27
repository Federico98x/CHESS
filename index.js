// Service worker unregistration removed to prevent conflicts with engines requiring SharedArrayBuffer.
if('serviceWorker' in navigator) {
    // navigator.serviceWorker.getRegistrations().then((registrations) => {
    //     registrations.forEach((registration) => {
    //         registration.unregister();
    //     });
    // });
}