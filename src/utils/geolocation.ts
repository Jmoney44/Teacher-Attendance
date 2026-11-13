export type Coordinates = {
  latitude: number;
  longitude: number;
};

export const getCurrentCoordinates = (): Promise<Coordinates> => new Promise((resolve, reject) => {
  if (!navigator.geolocation) {
    reject(new Error('This device or browser does not support location access.'));
    return;
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
    (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        reject(new Error('Allow location access in your browser to continue.'));
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        reject(new Error('Your current location is unavailable. Try again where GPS reception is better.'));
      } else {
        reject(new Error('Location lookup timed out. Please try again.'));
      }
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
});
