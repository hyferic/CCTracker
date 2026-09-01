import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { updateProfileLanguage } from '../../services/api';
import { ProfileContext } from '../profile/ProfileContext';
import type { Profile, RecurrenceBasis, RecurrenceType } from '../../types';

export type Language = 'en' | 'zh-CN';

const STORAGE_KEY = 'perkledger.language';

function readStoredLanguage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLanguage(language: Language) {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Private browsing and test environments may not expose writable storage.
  }
}

const messages = {
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.benefits': 'Benefits',
    'nav.accounts': 'Cards & accounts',
    'nav.settings': 'Settings & data',
    'common.addBenefit': 'Add benefit',
    'common.loading': 'Loading',
    'common.tryAgain': 'Try again',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.skipToContent': 'Skip to main content',
    'common.primaryNavigation': 'Primary navigation',
    'common.closeMenu': 'Close menu',
    'common.openMenu': 'Open menu',
    'common.signOut': 'Sign out',
    'common.owner': 'Owner',
    'common.benefitTracker': 'Benefit tracker',
    'common.benefitPeriod': 'Benefit period',
    'common.editBenefit': 'Edit benefit',
    'common.errorTitle': 'We could not load this information',
    'common.loadingLabel': 'Loading',
    'common.notFound': 'This item was not found or you no longer have access.',
    'common.unsaved': 'Unsaved changes',
    'common.saved': 'Saved',
    'common.required': 'required',
    'common.optional': 'optional',
    'common.back': 'Back',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.export': 'Export',
    'common.import': 'Import',
    'common.confirm': 'Confirm',
    'common.yes': 'Yes',
    'common.no': 'No',
    'status.unused': 'Unused',
    'status.partial': 'Partially used',
    'status.used': 'Used',
    'status.upcoming': 'Upcoming',
    'status.expired': 'Expired',
    'status.void': 'Voided',
    'status.expiringSoon': 'Expiring soon',
    'status.enrollmentOverdue': 'Enrollment overdue',
    'status.enrollmentDueSoon': 'Enrollment due within 7 days',
    'status.enrollmentDueLater': 'Enrollment due in 8–30 days',
    'status.days': '{count} days',
    'login.introduction': 'Product introduction',
    'login.promise': 'Your benefits, on time',
    'login.title': 'Stop leaving credits on the table.',
    'login.description':
      'Track card benefits, cashback offers, reimbursements, and every reset—without storing sensitive card credentials.',
    'login.privateAccess': 'Private, owner-only access',
    'login.recurring': 'Calendar-correct recurring periods',
    'login.reminders': 'Email reminders while you are offline',
    'login.footnote': 'Built for a clear view of what is available now.',
    'login.setupNeeded': 'Setup needed',
    'login.connectDatabase': 'Connect your private database',
    'login.deploymentHelp':
      'Follow the deployment guide to add the Supabase project URL and publishable key. No service-role or email secret belongs in the browser.',
    'login.checkInbox': 'Check your inbox',
    'login.secureLinkSent': 'Your secure link is on its way',
    'login.linkHelp':
      'Open the link on this same device and in this browser. PKCE links cannot be moved to a different browser safely.',
    'login.sendAnother': 'Send another link',
    'login.privateDashboard': 'Private dashboard',
    'login.welcome': 'Welcome back',
    'login.signInHelp':
      'Use your saved passkey, or the confirmed owner email configured in Supabase.',
    'login.waitingPasskey': 'Waiting for passkey…',
    'login.signInPasskey': 'Sign in with passkey',
    'login.email': 'Email address',
    'login.sending': 'Sending…',
    'login.sendLink': 'Email me a secure sign-in link',
    'login.privacy':
      'No password is stored by this app. Set up a passkey from Settings after an email-link sign-in; unknown email addresses cannot create accounts.',
    'login.signInError': 'Could not send the sign-in link.',
    'login.passkeyError': 'Could not sign in with this passkey. Try your email link instead.',
    'settings.preferences': 'Preferences, portability & operations',
    'settings.title': 'Keep the tracker dependable.',
    'settings.description':
      'Manage local-date behavior, email preferences, backups, and reminder health.',
    'settings.timezoneReminders': 'Timezone & reminders',
    'settings.timezoneHelp': 'Date boundaries are calculated in this explicit IANA timezone.',
    'settings.timezone': 'Timezone',
    'settings.timezoneChangeHelp':
      'Changing this affects “today” and future processing; existing date-only history never shifts.',
    'settings.notificationRecipient': 'Verified notification recipient',
    'settings.notificationHelp':
      'Reminders can only go to the confirmed email on your signed-in account. Change and verify that address through authentication before using a different recipient.',
    'settings.savedDateHelp': 'Settings saved. Existing date-only periods did not shift.',
    'settings.saveError': 'Could not save settings.',
    'settings.invalidTimezone': 'Enter a valid IANA timezone such as America/New_York.',
    'settings.passkeyAdded':
      'Passkey added. You can now use it from this iPhone Home Screen app or another compatible device.',
    'settings.passkeyError':
      'Could not add a passkey. Confirm passkeys are enabled in Supabase, then try again.',
    'settings.exported':
      'Canonical JSON backup exported. Encrypt it before storing it off-repository.',
    'settings.exportError': 'Could not export data.',
    'settings.csvExported': '{entity} CSV exported.',
    'settings.csvError': 'Could not export CSV.',
    'settings.backupInvalid': 'Could not validate this backup.',
    'settings.restoreConfirm':
      'Schedule fresh notifications? Emails sent before this restore cannot be deduplicated, so this may produce a duplicate reminder.',
    'settings.restoreComplete':
      'Restore completed atomically: {accounts} accounts, {definitions} definitions, {instances} periods, and {redemptions} usage entries.',
    'settings.restoreError': 'Restore failed. Nothing was imported.',
    'benefits.eyebrow': 'Definitions & history',
    'benefits.title': 'Manage benefit rules.',
    'benefits.description':
      'Definitions describe the rules. Every recurring period stays separate so edits never erase usage history.',
    'benefits.emptyTitle': 'No benefit definitions yet',
    'benefits.emptyBody':
      'Add a fixed credit, cashback offer, points benefit, membership, or custom value.',
    'benefits.addFirst': 'Add your first benefit',
    'benefits.definitions': 'Benefit definitions',
    'benefits.active': 'Active',
    'benefits.inactive': 'Inactive',
    'benefits.currentValue': 'Current value',
    'benefits.currentPeriod': 'Current period',
    'benefits.history': 'History',
    'benefits.viewPeriod': 'View current period',
    'benefits.editRules': 'Edit rules',
    'benefits.disableRecurrence': 'Disable recurrence',
    'benefits.enableRecurrence': 'Re-enable recurrence',
    'benefits.deactivate': 'Deactivate',
    'benefits.reactivate': 'Reactivate',
    'benefits.deleteDraft': 'Delete draft',
    'benefits.periodHistory': 'Period history',
    'benefits.deactivateConfirm':
      'Deactivate this benefit? History stays available, but reminders and dashboard actions are suppressed.',
    'benefits.recurrenceConfirm':
      'Disable recurrence? Current and historical periods stay, while unused future periods are voided.',
    'benefits.deleteConfirm':
      'Permanently delete this unreferenced future draft? Anything with current/history activity must be deactivated instead.',
    'benefits.updateError': 'Could not update this benefit.',
    'benefits.recurrenceError': 'Could not update recurrence.',
    'benefits.deleteError': 'Could not delete this draft.',
    'accounts.title': 'Keep every card in view.',
    'accounts.description':
      'Use a verified catalog product when available, or create a custom account and add benefits manually.',
    'accounts.accounts': 'Cards and accounts',
    'accounts.add': 'Add account',
    'accounts.emptyTitle': 'No accounts yet',
    'accounts.emptyBody': 'Add a card or account before attaching benefits.',
    'accounts.chooseCard': 'Choose the exact card product',
    'accounts.customCard': 'Custom card, service, or portal',
    'accounts.continue': 'Continue to details',
    'accounts.cancel': 'Cancel',
    'accounts.back': 'Back',
    'accounts.create': 'Create account',
    'accounts.edit': 'Edit account',
    'accounts.delete': 'Delete',
    'accounts.close': 'Close',
    'accounts.displayName': 'Display name',
    'accounts.issuer': 'Issuer/provider',
    'accounts.cardName': 'Card/service name',
    'accounts.nickname': 'Nickname',
    'accounts.lastFour': 'Last four',
    'accounts.annualFee': 'Annual fee',
    'accounts.renewal': 'Fee renewal date',
    'accounts.benefitAnniversary': 'Benefit anniversary/reset date',
    'accounts.notes': 'Notes',
    'accounts.active': 'Active account',
    'accounts.activeHelp': 'Inactive accounts stay in history.',
    'accounts.catalogUnavailable':
      'The catalog is unavailable. Custom account and manual benefit entry remain available.',
    'accounts.validationError': 'Please review the account details.',
    'accounts.saveError': 'Could not save the account.',
    'accounts.deleteConfirm': 'Delete this account? Existing history remains available.',
    'accounts.deleteError': 'Could not delete this account.',
    'instance.benefits': 'Benefits',
    'instance.breadcrumb': 'Breadcrumb',
    'instance.currentPeriod': 'Current period',
    'instance.datesReset': 'Dates & reset',
    'instance.availableFrom': 'Available from',
    'instance.expires': 'Expires',
    'instance.daysRemaining': 'Days remaining',
    'instance.displayReset': 'Display reset date',
    'instance.recurrence': 'Recurrence',
    'instance.occurrence': 'Occurrence',
    'instance.eligibility': 'Eligibility',
    'instance.whereApplies': 'Where it applies',
    'instance.merchant': 'Merchant',
    'instance.merchantCategory': 'Merchant category',
    'instance.cashbackRate': 'Cashback rate',
    'instance.minimumSpend': 'Minimum spend',
    'instance.website': 'Website',
    'instance.openWebsite': 'Open eligible website',
    'instance.enrollment': 'Enrollment',
    'instance.required': 'Required',
    'instance.notRequired': 'Not required',
    'instance.finePrint': 'Fine print',
    'instance.redemptionHistory': 'Redemption history',
    'instance.recordUsage': 'Record usage',
    'instance.useRemainder': 'Use remaining balance',
    'instance.noUsage': 'No usage recorded for this period.',
    'instance.editUsage': 'Edit usage',
    'instance.amountUsed': 'Benefit amount used',
    'instance.dateUsed': 'Date used',
    'instance.transaction': 'Transaction description',
    'instance.privateNotes': 'Private notes',
    'instance.saveUsage': 'Save usage',
    'instance.usageUpdated': 'Usage updated.',
    'instance.usageRecorded': 'Usage recorded. Remaining value was recalculated.',
    'instance.saveError': 'Could not save usage.',
    'instance.deleteUsageConfirm':
      'Delete this usage entry? The remaining balance will increase automatically.',
    'instance.deleteUsage': 'Usage entry deleted and balance recalculated.',
    'instance.deleteError': 'Could not delete usage.',
    'instance.completeConfirm':
      'Mark this uncapped offer complete? Earned cashback entries remain in history.',
    'instance.complete': 'Offer marked complete.',
    'instance.completeError': 'Could not mark the offer complete.',
    'instance.enrollConfirm':
      'Mark enrollment complete today for this benefit and its future periods?',
    'instance.enrolled': 'Enrollment marked complete.',
    'instance.enrollError': 'Could not mark enrollment complete.',
    'instance.auditVersion': 'Historical audit version.',
    'instance.readOnly': 'This period was superseded and is read-only.',
    'instance.anyEligible': 'Any eligible merchant',
    'instance.notSpecified': 'Not specified',
    'instance.uncappedHelp':
      'Enter cashback or statement-credit value earned—not the gross purchase amount.',
    'dashboard.eyebrow': 'At a glance',
    'dashboard.title': 'Make every benefit count.',
    'dashboard.description': 'The most valuable benefits are shown first.',
    'dashboard.emptyTitle': 'No benefits need attention',
    'dashboard.emptyBody': 'You have no outstanding benefits right now.',
    'dashboard.emptyAction': 'Add a benefit',
    'dashboard.staleTitle': 'Reminder processing needs attention.',
    'dashboard.staleBody': 'No successful scheduler run has been recorded in more than 36 hours.',
    'dashboard.recovery': 'View recovery steps',
    'dashboard.outstanding': 'Outstanding benefits',
    'dashboard.remaining': 'remaining',
    'dashboard.of': 'of',
    'dashboard.ends': 'Ends',
    'dashboard.resets': 'Resets',
    'dashboard.usageCondition': 'Use at eligible merchants',
    'dashboard.recordUsage': 'Record usage',
    'dashboard.markComplete': 'Mark complete',
    'dashboard.completeConfirm':
      'Mark this uncapped benefit complete? It will leave the dashboard while its history is preserved.',
    'dashboard.recorded': 'Usage recorded',
    'dashboard.recordedBody': 'You can edit or remove this entry from the benefit details.',
    'dashboard.completeBody': 'You can undo this completion while this notice is visible.',
    'dashboard.openDetails': 'Open benefit details',
    'dashboard.amountUsed': 'Amount used',
    'dashboard.confirmUsage': 'Confirm usage',
    'dashboard.confirmBody': 'Enter the amount used. The current date will be recorded by default.',
    'dashboard.saveUsage': 'Save usage',
    'dashboard.saving': 'Saving…',
    'dashboard.dueSoon': 'Due within 7 days',
    'dashboard.thisMonth': 'Due this month',
    'dashboard.thisQuarter': 'Due this quarter',
    'dashboard.thisYear': 'Due this year',
    'dashboard.noDeadline': 'No clear deadline',
    'dashboard.partial': 'Partially used',
    'dashboard.available': 'Available',
    'dashboard.condition': 'Condition',
    'dashboard.conditionUnknown': 'Conditions not specified',
    'dashboard.cashback': 'cashback',
    'dashboard.minimumSpend': 'Minimum spend',
    'dashboard.enrollmentRequired': 'Enrollment required',
    'dashboard.dateUsed': 'Date used',
    'dashboard.invalidAmount': 'Enter a positive amount.',
    'dashboard.saveError': 'Could not save usage.',
    'dashboard.undo': 'Undo completion',
    'dashboard.reopened': 'Benefit reopened',
    'dashboard.reopenedBody': 'It is back on the dashboard and its history was preserved.',
    'dashboard.completeError': 'Could not mark this benefit complete.',
    'settings.language': 'Language',
    'settings.languageHelp': 'Choose the language used throughout the app.',
    'settings.english': 'English',
    'settings.chinese': '简体中文',
    'settings.languageSaved': 'Language changes are saved after confirmation.',
  },
  'zh-CN': {
    'nav.dashboard': '仪表盘',
    'nav.benefits': '福利',
    'nav.accounts': '信用卡与账户',
    'nav.settings': '设置与数据',
    'common.addBenefit': '添加福利',
    'common.loading': '加载中',
    'common.tryAgain': '重试',
    'common.save': '保存',
    'common.cancel': '取消',
    'common.close': '关闭',
    'common.skipToContent': '跳转到主要内容',
    'common.primaryNavigation': '主导航',
    'common.closeMenu': '关闭菜单',
    'common.openMenu': '打开菜单',
    'common.signOut': '退出登录',
    'common.owner': '账户所有者',
    'common.benefitTracker': '福利追踪器',
    'common.benefitPeriod': '福利周期',
    'common.editBenefit': '编辑福利',
    'common.errorTitle': '无法加载此信息',
    'common.loadingLabel': '加载中',
    'common.notFound': '找不到此项目，或你已无权访问。',
    'common.unsaved': '未保存的更改',
    'common.saved': '已保存',
    'common.required': '必填',
    'common.optional': '可选',
    'common.back': '返回',
    'common.delete': '删除',
    'common.edit': '编辑',
    'common.export': '导出',
    'common.import': '导入',
    'common.confirm': '确认',
    'common.yes': '是',
    'common.no': '否',
    'status.unused': '未使用',
    'status.partial': '部分使用',
    'status.used': '已使用',
    'status.upcoming': '即将开始',
    'status.expired': '已过期',
    'status.void': '已作废',
    'status.expiringSoon': '即将到期',
    'status.enrollmentOverdue': '注册已逾期',
    'status.enrollmentDueSoon': '注册将在 7 天内截止',
    'status.enrollmentDueLater': '注册将在 8–30 天内截止',
    'status.days': '{count} 天',
    'login.introduction': '产品介绍',
    'login.promise': '按时用好你的福利',
    'login.title': '别让信用额度白白浪费。',
    'login.description': '追踪信用卡福利、返现、报销和每次重置，不在应用中保存敏感的卡片凭证。',
    'login.privateAccess': '仅限账户所有者访问',
    'login.recurring': '准确的周期福利计算',
    'login.reminders': '离线时也能收到邮件提醒',
    'login.footnote': '清晰掌握当前可用的福利。',
    'login.setupNeeded': '需要设置',
    'login.connectDatabase': '连接你的私有数据库',
    'login.deploymentHelp':
      '按照部署指南添加 Supabase 项目 URL 和 publishable key。服务角色密钥或邮件密钥不应放在浏览器中。',
    'login.checkInbox': '请查收收件箱',
    'login.secureLinkSent': '安全链接已发送',
    'login.linkHelp': '请在同一台设备和浏览器中打开链接。PKCE 链接不能安全地转移到其他浏览器。',
    'login.sendAnother': '再发送一次链接',
    'login.privateDashboard': '私密仪表盘',
    'login.welcome': '欢迎回来',
    'login.signInHelp': '使用已保存的通行密钥，或使用 Supabase 中已确认的账户所有者邮箱。',
    'login.waitingPasskey': '等待通行密钥…',
    'login.signInPasskey': '使用通行密钥登录',
    'login.email': '邮箱地址',
    'login.sending': '发送中…',
    'login.sendLink': '发送安全登录链接到我的邮箱',
    'login.privacy':
      '应用不会保存密码。通过邮箱链接登录后，可在设置中添加通行密钥；未知邮箱无法创建账户。',
    'login.signInError': '无法发送登录链接。',
    'login.passkeyError': '无法使用此通行密钥登录，请改用邮箱链接。',
    'settings.preferences': '偏好设置、数据迁移与运行状态',
    'settings.title': '让福利追踪始终可靠。',
    'settings.description': '管理本地日期、邮件偏好、备份和提醒状态。',
    'settings.timezoneReminders': '时区与提醒',
    'settings.timezoneHelp': '日期边界按此明确的 IANA 时区计算。',
    'settings.timezone': '时区',
    'settings.timezoneChangeHelp': '更改会影响“今天”和未来处理；已有日期历史不会移动。',
    'settings.notificationRecipient': '已验证的提醒收件人',
    'settings.notificationHelp':
      '提醒只能发送到登录账户中已确认的邮箱。若要使用其他收件人，请先通过身份验证更改并确认邮箱。',
    'settings.savedDateHelp': '设置已保存。已有日期周期没有移动。',
    'settings.saveError': '无法保存设置。',
    'settings.invalidTimezone': '请输入有效的 IANA 时区，例如 America/New_York。',
    'settings.passkeyAdded': '通行密钥已添加。现在可以在 iPhone 主屏幕应用或其他兼容设备上使用。',
    'settings.passkeyError': '无法添加通行密钥，请确认 Supabase 已启用通行密钥后重试。',
    'settings.exported': '标准 JSON 备份已导出。存储到仓库外前请先加密。',
    'settings.exportError': '无法导出数据。',
    'settings.csvExported': '{entity} CSV 已导出。',
    'settings.csvError': '无法导出 CSV。',
    'settings.backupInvalid': '无法验证此备份。',
    'settings.restoreConfirm': '要安排新的提醒吗？恢复前发送的邮件无法去重，因此可能收到重复提醒。',
    'settings.restoreComplete':
      '恢复已原子完成：{accounts} 个账户、{definitions} 个福利、{instances} 个周期和 {redemptions} 条使用记录。',
    'settings.restoreError': '恢复失败，没有导入任何内容。',
    'benefits.eyebrow': '规则与历史',
    'benefits.title': '管理福利规则。',
    'benefits.description': '福利定义描述规则。每个周期独立保存，因此编辑不会抹掉使用历史。',
    'benefits.emptyTitle': '还没有福利定义',
    'benefits.emptyBody': '添加固定额度、返现、积分、会员权益或自定义福利。',
    'benefits.addFirst': '添加第一个福利',
    'benefits.definitions': '福利定义',
    'benefits.active': '启用',
    'benefits.inactive': '停用',
    'benefits.currentValue': '当前价值',
    'benefits.currentPeriod': '当前周期',
    'benefits.history': '历史',
    'benefits.viewPeriod': '查看当前周期',
    'benefits.editRules': '编辑规则',
    'benefits.disableRecurrence': '停用周期',
    'benefits.enableRecurrence': '重新启用周期',
    'benefits.deactivate': '停用',
    'benefits.reactivate': '重新启用',
    'benefits.deleteDraft': '删除草稿',
    'benefits.periodHistory': '周期历史',
    'benefits.deactivateConfirm': '确定停用此福利吗？历史仍可查看，但提醒和仪表盘操作会被抑制。',
    'benefits.recurrenceConfirm': '确定停用周期吗？当前和历史周期会保留，未使用的未来周期会作废。',
    'benefits.deleteConfirm':
      '永久删除这个没有引用的未来草稿吗？已有当前或历史活动的福利只能停用。',
    'benefits.updateError': '无法更新此福利。',
    'benefits.recurrenceError': '无法更新周期设置。',
    'benefits.deleteError': '无法删除此草稿。',
    'accounts.title': '掌握每一张信用卡。',
    'accounts.description':
      '有可用的已验证目录产品时优先使用；也可以创建自定义账户并手动添加福利。',
    'accounts.accounts': '信用卡与账户',
    'accounts.add': '添加账户',
    'accounts.emptyTitle': '还没有账户',
    'accounts.emptyBody': '请先添加信用卡或账户，再关联福利。',
    'accounts.chooseCard': '选择准确的卡片产品',
    'accounts.customCard': '自定义信用卡、服务或门户',
    'accounts.continue': '继续填写详情',
    'accounts.cancel': '取消',
    'accounts.back': '返回',
    'accounts.create': '创建账户',
    'accounts.edit': '编辑账户',
    'accounts.delete': '删除',
    'accounts.close': '关闭',
    'accounts.displayName': '显示名称',
    'accounts.issuer': '发卡行/提供方',
    'accounts.cardName': '卡片/服务名称',
    'accounts.nickname': '昵称',
    'accounts.lastFour': '末四位',
    'accounts.annualFee': '年费',
    'accounts.renewal': '年费续期日期',
    'accounts.benefitAnniversary': '福利周年/重置日期',
    'accounts.notes': '备注',
    'accounts.active': '启用账户',
    'accounts.activeHelp': '停用账户仍会保留在历史记录中。',
    'accounts.catalogUnavailable': '目录暂不可用。仍可创建自定义账户并手动添加福利。',
    'accounts.validationError': '请检查账户详情。',
    'accounts.saveError': '无法保存账户。',
    'accounts.deleteConfirm': '确定删除此账户吗？已有历史记录仍会保留。',
    'accounts.deleteError': '无法删除此账户。',
    'instance.benefits': '福利',
    'instance.breadcrumb': '面包屑导航',
    'instance.currentPeriod': '当前周期',
    'instance.datesReset': '日期与重置',
    'instance.availableFrom': '开始日期',
    'instance.expires': '到期日期',
    'instance.daysRemaining': '剩余天数',
    'instance.displayReset': '显示重置日期',
    'instance.recurrence': '周期',
    'instance.occurrence': '发生记录',
    'instance.eligibility': '适用条件',
    'instance.whereApplies': '适用范围',
    'instance.merchant': '商户',
    'instance.merchantCategory': '商户类别',
    'instance.cashbackRate': '返现比例',
    'instance.minimumSpend': '最低消费',
    'instance.website': '网站',
    'instance.openWebsite': '打开适用网站',
    'instance.enrollment': '注册',
    'instance.required': '需要',
    'instance.notRequired': '不需要',
    'instance.finePrint': '细则',
    'instance.redemptionHistory': '使用历史',
    'instance.recordUsage': '记录使用',
    'instance.useRemainder': '使用剩余额度',
    'instance.noUsage': '此周期尚无使用记录。',
    'instance.editUsage': '编辑使用记录',
    'instance.amountUsed': '本次使用的福利金额',
    'instance.dateUsed': '使用日期',
    'instance.transaction': '交易说明',
    'instance.privateNotes': '私人备注',
    'instance.saveUsage': '保存使用记录',
    'instance.usageUpdated': '使用记录已更新。',
    'instance.usageRecorded': '使用记录已保存，剩余价值已重新计算。',
    'instance.saveError': '无法保存使用记录。',
    'instance.deleteUsageConfirm': '删除这条使用记录吗？剩余余额会自动增加。',
    'instance.deleteUsage': '使用记录已删除，余额已重新计算。',
    'instance.deleteError': '无法删除使用记录。',
    'instance.completeConfirm': '将此不限额度福利标记为完成吗？已获得的返现记录会保留在历史中。',
    'instance.complete': '福利已标记完成。',
    'instance.completeError': '无法标记福利完成。',
    'instance.enrollConfirm': '今天将此福利及其未来周期标记为已注册吗？',
    'instance.enrolled': '注册已完成。',
    'instance.enrollError': '无法完成注册标记。',
    'instance.auditVersion': '历史审计版本。',
    'instance.readOnly': '此周期已被替代，只能读取。',
    'instance.anyEligible': '任何符合条件的商户',
    'instance.notSpecified': '未注明',
    'instance.uncappedHelp': '请输入已获得的返现或账单抵扣金额，而不是消费总额。',
    'dashboard.eyebrow': '一览',
    'dashboard.title': '别让信用卡福利白白过期。',
    'dashboard.description': '最值得优先使用的福利会显示在前面。',
    'dashboard.emptyTitle': '目前没有待处理福利',
    'dashboard.emptyBody': '你现在没有尚未使用完的福利。',
    'dashboard.emptyAction': '添加福利',
    'dashboard.staleTitle': '提醒处理需要关注。',
    'dashboard.staleBody': '超过 36 小时没有成功的提醒任务记录。',
    'dashboard.recovery': '查看恢复步骤',
    'dashboard.outstanding': '待使用福利',
    'dashboard.remaining': '剩余',
    'dashboard.of': '共',
    'dashboard.ends': '到期',
    'dashboard.resets': '重置',
    'dashboard.usageCondition': '可在符合条件的商户使用',
    'dashboard.recordUsage': '记录使用',
    'dashboard.markComplete': '标记完成',
    'dashboard.completeConfirm':
      '确定将此不限额度福利标记为完成吗？它会从仪表盘移除，但历史记录会保留。',
    'dashboard.recorded': '已记录使用',
    'dashboard.recordedBody': '可以在福利详情中编辑或删除这条记录。',
    'dashboard.completeBody': '此提示仍显示时，可以撤销完成标记。',
    'dashboard.openDetails': '打开福利详情',
    'dashboard.amountUsed': '本次使用金额',
    'dashboard.confirmUsage': '确认使用',
    'dashboard.confirmBody': '输入本次使用的金额，默认记录今天。',
    'dashboard.saveUsage': '保存使用记录',
    'dashboard.saving': '保存中…',
    'dashboard.dueSoon': '7 天内到期',
    'dashboard.thisMonth': '本月到期',
    'dashboard.thisQuarter': '本季度到期',
    'dashboard.thisYear': '本年度到期',
    'dashboard.noDeadline': '没有明确期限',
    'dashboard.partial': '部分使用',
    'dashboard.available': '可使用',
    'dashboard.condition': '使用条件',
    'dashboard.conditionUnknown': '未注明使用条件',
    'dashboard.cashback': '返现',
    'dashboard.minimumSpend': '最低消费',
    'dashboard.enrollmentRequired': '需要注册',
    'dashboard.dateUsed': '使用日期',
    'dashboard.invalidAmount': '请输入大于 0 的金额。',
    'dashboard.saveError': '无法保存使用记录。',
    'settings.language': '语言',
    'settings.languageHelp': '选择整个应用使用的语言。',
    'settings.english': 'English',
    'settings.chinese': '简体中文',
    'settings.languageSaved': '语言更改将在确认后保存。',
    'dashboard.undo': '撤销完成标记',
    'dashboard.reopened': '福利已重新打开',
    'dashboard.reopenedBody': '它已回到仪表盘，历史记录已保留。',
    'dashboard.completeError': '无法将此福利标记为完成。',
  },
} as const;

export type MessageKey = keyof (typeof messages)['en'];

const recurrenceTypeLabels: Record<RecurrenceType, readonly [string, string]> = {
  one_time: ['One-time', '一次性'],
  monthly: ['Monthly', '每月'],
  quarterly: ['Quarterly', '每季度'],
  semiannual: ['Semiannual', '每半年'],
  annual: ['Annual', '每年'],
  custom: ['Custom interval', '自定义周期'],
};

const recurrenceBasisLabels: Record<Exclude<RecurrenceBasis, 'none'>, readonly [string, string]> = {
  calendar: ['calendar', '自然日历'],
  anniversary: ['anniversary', '周年日'],
};

export function recurrenceLabel(
  type: RecurrenceType,
  basis: RecurrenceBasis,
  localize: (english: string, simplifiedChinese: string) => string,
) {
  const [englishType, simplifiedChineseType] = recurrenceTypeLabels[type];
  const typeLabel = localize(englishType, simplifiedChineseType);
  if (type === 'one_time') return typeLabel;
  const [englishBasis, simplifiedChineseBasis] =
    recurrenceBasisLabels[basis === 'anniversary' ? 'anniversary' : 'calendar'];
  return `${typeLabel} · ${localize(englishBasis, simplifiedChineseBasis)}`;
}

export function recurrenceTypeLabel(
  type: RecurrenceType,
  localize: (english: string, simplifiedChinese: string) => string,
) {
  const [english, simplifiedChinese] = recurrenceTypeLabels[type];
  return localize(english, simplifiedChinese);
}

interface I18nValue {
  language: Language;
  setLanguage: (language: Language) => Promise<void>;
  t: (key: MessageKey) => string;
  localize: (english: string, simplifiedChinese: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function initialLanguage(profileLanguage?: Profile['language']): Language {
  if (profileLanguage) return profileLanguage;
  if (typeof window !== 'undefined') {
    const saved = readStoredLanguage();
    if (saved === 'en' || saved === 'zh-CN') return saved;
    if (navigator.language.toLowerCase().startsWith('zh')) return 'zh-CN';
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const profileContext = useContext(ProfileContext);
  const [language, setLanguageState] = useState<Language>(() =>
    initialLanguage(profileContext?.profile.language),
  );
  const setLanguage = useCallback(
    async (next: Language) => {
      const previous = language;
      setLanguageState(next);
      storeLanguage(next);
      try {
        const profile = await updateProfileLanguage(next);
        profileContext?.replaceProfile(profile);
      } catch (caught) {
        setLanguageState(previous);
        storeLanguage(previous);
        throw caught;
      }
    },
    [language, profileContext],
  );
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage,
      t: (key) => messages[language][key] ?? messages.en[key],
      localize: (english, simplifiedChinese) =>
        language === 'zh-CN' ? simplifiedChinese : english,
    }),
    [language, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider.');
  return value;
}

export function useOptionalI18n() {
  return useContext(I18nContext);
}
