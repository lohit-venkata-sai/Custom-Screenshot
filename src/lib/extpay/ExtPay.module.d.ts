declare const ExtPay: (extensionId: string) => {
  getUser: () => Promise<{ paid: boolean; email: string | null }>;
  openPaymentPage: (planNickname?: string) => void;
  openLoginPage: () => void;
  startBackground: () => void;
};
export default ExtPay;
