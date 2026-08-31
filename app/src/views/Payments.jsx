import PaymentRegister from "../components/PaymentRegister.jsx";

// Spend → Payments: the money-out side of the register.
export default function PaymentsView({ db, actions, toast, readOnly }) {
  return <PaymentRegister db={db} actions={actions} toast={toast} readOnly={readOnly} kind="bill" />;
}
