export const platformConfig = {
  auth: {
    qq: {
      provider: "qq",
      appId: "",
      appSecret: "",
      callbackUrl: "",
    },
    wechat: {
      provider: "wechat",
      appId: "",
      appSecret: "",
      callbackUrl: "",
    },
    aliyunSmsProxy: {
      provider: "aliyun_sms_proxy",
      proxyEndpoint: "",
      accessKeyId: "",
      accessKeySecret: "",
      signName: "",
      templateCodeLogin: "",
      templateCodeRegister: "",
    },
  },
  payment: {
    provider: "yishoumi_proxy",
    alipay: {
      appId: "",
      merchantNo: "",
      notifyUrl: "",
      returnUrl: "",
      proxyEndpoint: "",
      signType: "RSA2",
    },
  },
} as const;
