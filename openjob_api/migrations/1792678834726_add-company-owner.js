exports.up = (pgm) => {
  pgm.addColumns("companies", {
    owner_id: {
      type: "varchar(50)",
      references: "users(id)",
      onDelete: "SET NULL",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("companies", ["owner_id"]);
};
