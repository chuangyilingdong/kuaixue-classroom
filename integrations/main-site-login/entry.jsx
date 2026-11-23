import React from 'react';
import { createRoot } from 'react-dom/client';
import SignIn from './SignIn.jsx';
import './captcha.css';
import '../../electron/classroom-font.css';
import '../../src/ui/login.css';

const marker = document.createElement('meta');
marker.name = 'kx-sign-in'; marker.content = '1'; document.head.appendChild(marker);
createRoot(document.getElementById('root')).render(<SignIn />);
