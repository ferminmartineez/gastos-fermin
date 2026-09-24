// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAoTuMwHU-3DW5FQH0Div3gqUlQ6Gj7lDI",
  authDomain: "gastos-fermin.firebaseapp.com",
  projectId: "gastos-fermin",
  storageBucket: "gastos-fermin.firebasestorage.app",
  messagingSenderId: "558000419206",
  appId: "1:558000419206:web:cf1cfa672790965bda7c07",
  measurementId: "G-92ZMYLG40S"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);