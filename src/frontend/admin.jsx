import React from 'react';
import ForgeReconciler, { Text } from '@forge/react';
import AdminPanel from './components/adminPanel';

const AdminApp = () => {
  return (
    <>
      <AdminPanel />
    </>
  );
};


ForgeReconciler.render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
