export const currentDateTime = async (date?: any) => {
  let now: any;
  if (date) {
    now = new Date(date);
  } else {
    now = new Date();
  }

  const year = now.getFullYear();
  let month: any = now.getMonth() + 1;
  let day: any = now.getDate();
  let hour: any = now.getHours();
  let minute: any = now.getMinutes();
  let second: any = now.getSeconds();

  if (month.toString().length == 1) {
    month = '0' + month;
  }
  if (day.toString().length == 1) {
    day = '0' + day;
  }
  if (hour.toString().length == 1) {
    hour = '0' + hour;
  }
  if (minute.toString().length == 1) {
    minute = '0' + minute;
  }
  if (second.toString().length == 1) {
    second = '0' + second;
  }
  const timeData: string =
    year +
    '-' +
    month +
    '-' +
    day +
    'T' +
    hour +
    ':' +
    minute +
    ':' +
    second +
    '.000Z';
  return timeData;
};
